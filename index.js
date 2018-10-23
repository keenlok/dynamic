let util = require('util');
let Emitter = require('events').EventEmitter;
let IOServer = require('socket.io');
let IOClient = require('socket.io/lib/client');
let IOSocket = require('socket.io/lib/socket');
let IONameSpace = require('socket.io/lib/namespace');
let parser = require('socket.io-parser');
let Adapter = require('socket.io-adapter');
let debug = require('debug')('dynamic.io');
let expandIpv6Address = require("./ipv6");

/**
 * Concatenate host and name for the full namespace name.
 * @param name
 * @param host
 * @returns {string}
 */
function fullNamespaceName(name, host) {
  return host == null ? name : '//' + host + name;
}

function makePattern(pattern) {
  if (pattern === true) {
    return new RegExp('.^');
  }
  if (pattern === '*') {
    return new RegExp('.*');
  }
  if (pattern instanceof RegExp) {
    return pattern;
  }
  return pattern;
}

function matchPattern(pattern, string) {
  if (pattern instanceof RegExp) {
    // if (string)
    let result = pattern.exec(string);
    console.log("Is there a match?", pattern, string, result);
    return pattern.exec(string);
  } else {
    return pattern == string ? {'0': string, index: 0, input: string} : null;
  }
}

/**
 * Extends an Ipv6 address from :: to 0:0:0:0:0:0:0:0
 * @param string
 * @returns {*}
 */
function extendAddress (string) {
  // console.log("The string for extending is", string);
  if (string === '::') {
    return expandIpv6Address(string);
  }
  if (!string.startsWith("localhost")) {
    let arr = string.split(':');
    let portNumber = arr.pop();
    let addr = '';
    for (let i = 0; i < arr.length; i++) {
      if (i === arr.length - 1) {
        addr = addr + arr[i];
      } else {
        addr = addr + ':' + arr[i];
      }
    }
    return expandIpv6Address(addr) + ':' + portNumber;
  }
  return string;
}

/**
 * Inherits from the Socket.io server but with extra fields and options like hosts,
 * and the methods to deal with the host.
 */
/**
 * Constructor to override
 * @param {http.Server|Number|Object} server, port or options
 * @param options
 * @returns {DynamicServer}
 */
function DynamicServer (server, options) {
  if (!(this instanceof DynamicServer)) {
    return new DynamicServer(server, options);
  }

  if ('object' == typeof server && !server.listen) {
    options = server;
  }
  options = options || {};

  this._cleanupTimer = null;
  this._cleanupTime = null;
  this._namespaceNames = {};
  this._namespacePatterns = [];

  this._mainHost = makePattern(options.host || '*');

  this._defaultRetirement = options.retirement || 10000;

  this._publicStatus = options.publicStatus || false;

  IOServer.apply(this, arguments);
  // console.log(this.nsps);
}

util.inherits(DynamicServer, IOServer);


/**
 * This is the setup for initializing dynamic namespaces.
 *
 * @param name
 * @param fn
 */
DynamicServer.prototype.setupNamespace =  function (name, fn) {
  let pattern = makePattern(name);
  if (pattern instanceof RegExp) {
    this._namespacePatterns.push({pattern: pattern, setup: fn});
  } else {
    this._namespaceNames[name] = fn;
  }

  // If there is a matching namespace already, then set it up.
  for (let j in this.nsps) {
    if (this.nsps.hasOwnProperty(j)) {
      let nsp = this.nsps[j];
      let match;
      if (!nsp.setupDone && !!(match = matchPattern(pattern, j))) {
        nsp.setupDone = -1;
        if (false === fn.apply(this, [nsp, match])) {
          nsp.setupDone = 0;
        } else {
          nsp.setupDone = 1;
        }
      }
    }
  }
}

DynamicServer.prototype.onconnection = function (conn) {
  let host = this.getHost(conn);
  if (!host || matchPattern(this._mainHost, extendAddress(host))) {
    host = null;
  }
  let client = new DynamicClient(this, conn, host);
  client.connect('/');
  return this;
}

// Allow users to override this in order to normalize hostnames.
DynamicServer.prototype.getHost = function (conn) {
  return conn.request.headers.host;
}

// Do the work of initializing a namespace when it is needed.
DynamicServer.prototype.initializeNamespace = function (name, host, auto) {
  let fullName = fullNamespaceName(name, host);
  let setup;
  let match;

  if (this._namespaceNames.hasOwnProperty(fullName)) {
    // && this._namespaceNames.hasOwnProperty(fullName)) {
    setup = this._namespaceNames[fullName];
    match = {
      '0': fullName,
      index: 0,
      input: fullName
    };
  } else {
    for (let i = this._namespacePatterns.length - 1; i >= 0; i--) {
      match = matchPattern(this._namespacePatterns[i].pattern, fullName);
      if (match) {
        setup = this._namespacePatterns[i].setup;
        break;
      }
    }
  }

  if (auto && !setup) {
    return null;
  }

  let nsp = new DynamicNamespace(this, name, host);

  if (auto) {
    nsp.retirement = this._defaultRetirement;
  }
  this.nsps[fullName] = nsp;
  if (setup) {
    nsp.setupDone = -1;
    if (false === setup.apply(this, [nsp, match])) {
      delete this.nsps[fullName];
      return null;
    } else {
      nsp.setupDone = 1;
    }
  }
  return nsp;
}

// When namespaces are emptied, they ask the server to poll
// them back for expiration.
DynamicServer.prototype.requestCleanupAfter = function (delay) {
    delay = Math.max(0, delay || 0);

    if (!(delay < Infinity)) {
      return;
    }

    let cleanupTime = delay + +(new Date);
    if (this._cleanupTimer && cleanupTime < this._cleanupTime) {
      clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    delay += Math.max(1, Math.min(delay, 5000));

    if (!this._cleanupTimer) {
      let server = this;
      this._cleanupTime = cleanupTime;
      this._cleanupTimer = setTimeout(() => {
        server._cleanupTimer = null;
        server._cleanupTime = null;
        server.cleanupExpiredNamespaces();
      }, delay);
    }
  }

// When doing cleanup, we scan all namespaces for their
// expiration dates.
DynamicServer.prototype.cleanupExpiredNamespaces = function () {
  let earliestUnexpired = Infinity;
  let now = +(new Date);
  for (let j in this.nsps) {
    if (this.nsps.hasOwnProperty(j)) {
      let nsp = this.nsps[j];
      let expiration = nsp._expiration();
      if (expiration <= now) {
        nsp.expire(true);
        delete this.nsps[j];
      } else {
        earliestUnexpired = Math.min(earliestUnexpired, expiration);
      }
    }
  }
  this.requestCleanupAfter(earliestUnexpired - now);
}

/**
 * Override "of" to handle an optional 'host' argument an "fn" of "true", which indicates a
 * request for an automatically created namespace.
 *
 * @param name
 * @param host
 * @param fn
 * @override
 */
DynamicServer.prototype.of = function (name, host, fn) {
  if (fn == null && typeof(host) == 'function') {
    fn = host;
    host = null;
  }
  if (!/^\//.test(name)) {
    // Insert a leading slash if needed.
    name = '/' + name;
  }

  // Add a leading hostname for lookup.
  let fullname = fullNamespaceName(name, host);
  if (!this.nsps[fullname]) {
    debug('initializing namespace %s', fullname);
    let nsp = this.initializeNamespace(name, host, fn === true);
    if (nsp == null) {
      debug('unrecognized namespace', fullname);
      return;
    }
  }
  if (typeof(fn) == 'function') {
    this.nsps[fullname].on('connect', fn);
  }
  return this.nsps[fullname];
}

DynamicServer.prototype.attachServe = function(srv) {
  debug('attaching web request handler');
  let prefix = this._path;
  let clientUrl = prefix + '/socket.io.js';
  let statusUrl = prefix + '/status';
  let evs = srv.listeners('request').slice(0);
  let self = this;
  srv.removeAllListeners('request');
  srv.on('request', (req, res) => {
    if (0 == req.url.indexOf(clientUrl)) {
      self.serve(req, res);
    } else if (self._publicStatus && 0 == req.url.indexOf(statusUrl)) {
      self.serveStatus(req, res);
    } else {
      for (let i = 0; i < evs.length; i++) {
        evs[i].call(srv, req, res);
      }
    }
  });
}

DynamicServer.prototype.serveStatus = function (req, res) {
  debug('serve status');
  let match = '*';
  if (!matchPattern(this._mainHost, req.headers.host)) {
    match = req.headers.host;
  }

  let html = ['<!doctype html>', '<html>', '<body>', '<pre>'];
  html.push('<a href="status">Refresh</a> active namespaces on ' + match, '');
  let sorted = [];
  for (let j in this.nsps) {
    if (this.nsps.hasOwnProperty(j)) {
      let nsp = this.nsps[j];
      if (match != '*' && nsp.host != match) {
        continue;
      }
      sorted.push(j);
    }
  }
  // Sorts by
  sorted.sort((a, b) => {
    if (a == b) {
      return 0;
    }
    a = a.replace(/\//g, '\uffff');
    b = b.replace(/\//g, '\uffff');

    if (a < b) {
      return -1;
    } else {
      return 1;
    }
  });

  let now = +(new Date);
  for (let i = 0; i < sorted.length; i++) {
    let nsp = this.nsps[sorted[i]];
    html.push(match == '*' ? nsp.fullName() : nsp.name);
    if (nsp.sockets.length == 0) {
      let remaining = nsp._expiration() - now;
      let expinfo = '';
      if (remaining < Infinity) {
        expinfo = '; expires ' + remaining / 1000 + 's';
      }
      html.push('  (no sockets' + expinfo + ')');
    } else for (var k = 0; k < nsp.sockets.length; ++k) {
      let socket = nsp.sockets[k];
      let clientdesc = '';
      if (socket.request.connection.remoteAddress) {
        clientdesc += ' from ' + socket.request.connection.remoteAddress;
      }
      let roomdesc = '';
      if (socket.rooms.length > 1) {
        for (var m = 0; m < socket.rooms.length; ++m) {
          if (socket.rooms[m] != socket.client.id) {
            roomdesc += ' ' + socket.rooms[m];
          }
        }
      }
      html.push(' socket ' + socket.id + clientdesc + roomdesc);
    }
    html.push('');
  }
  res.setHeader('Content-Type', 'text/html');
  res.writeHead(200);
  res.end(html.join('\n'));
}



/**
 * Relies on "of" to make a namespace
 */
class DynamicClient extends IOClient {
  constructor (server, conn, host) {
    super(server, conn);
    this.host = host;
  }

  /**
   * Add hostname to namespace even if it doesn't exists yet.
   * @param name
   */
  connect (name) {
    debug('connecting to namespace %s (%s)', name, this.host);
    let nsp = this.server.of(name, this.host, true);
    if (nsp == null) {
      this.packet({
        type: parser.ERROR,
        nsp: name,
        data: 'Invalid namespace'
      });
      return;
    }
    let self = this;
    let socket = nsp.add(this, function() {
      self.sockets.push(socket);
      debug('client %s adding socket as self.nsps[&s]', self.id, name);
      self.nsps[name] = socket;
      if (name == '/' && self.connectBuffer.length > 0) {
        self.connectBuffer.forEach(self.connect, self);
        self.connectBuffer = [];
      }
    });
  }
}

/**
 * Extends Socket.io Namespace
 * Start the id at a large number instead of 0
 * Will be deleted if no socket attached to this namespace.
 */
class DynamicNamespace extends IONameSpace {

  constructor (server, name, host) {
    super(server, name);
    this.host = host;
    this.setupDone = 0;
    this.retirement = Infinity;
    this.ids = Math.floor(Math.random() * 1000000000);
    this._expirationTime = Infinity;
    this._expirationCallbacks = null;
  }

  /**
   * Calls the Socket.io remove, which removes a client. Called by each `Socket`.
   * At the end of remove, request cleanup if there are no sockets.
   *
   * @param socket
   */
  remove (socket) {
    super.remove.apply(this, socket);
    if (!this.sockets.length) {
      this._expirationTime = +(new Date) + this.retirement;
      this.server.requestCleanupAfter(this.retirement);
    }
  }

  /**
   * Setup expire callback
   *
   * @param callback the expire callback function
   */
  expire (callback) {
    if (callback !== true) {
      if (!this._expirationCallbacks) {
        this._expirationCallbacks = [];
      }
      this._expirationCallbacks.push(callback);
    } else {
      let callbacks = this._expirationCallbacks;
      if (callbacks) {
        this._expirationCallbacks = null;
        while (callbacks.length > 0) {
          callbacks.pop().apply(null, [this]);
        }
      }
    }
  }

  /**
   * Concatenate host and name for the full namespace name.
   *
   * @returns {string}
   */
  fullname () {
    return fullNamespaceName(this.name, this.host);
  }

  /**
   * If there are no sockets, the namespace will expire after the _expirationTime
   *
   * @returns {number}
   * @private
   */
  _expiration () {
    if (this.sockets.length) {
      return Infinity;
    }
    return this._expirationTime;
  }

  /**
   * When socket is added, dynamic namespace not in retirement and won't expire.
   *  _expirationTime reset to infinity. Also adds a client to the namespace.
   *
   * @returns {*}
   */
  add () {
    this._expirationTime = Infinity;
    return super.add.apply(this, arguments);
  }

}



exports.DynamicServer = DynamicServer;
exports.DynamicClient = DynamicClient;
exports.DynamicNamespace = DynamicNamespace;
exports.DynamicSocket = IOSocket;

module.exports = exports;

