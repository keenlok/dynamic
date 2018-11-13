var util = require('util');
var Emitter = require('events').EventEmitter;
var IOServer = require('socket.io');
var IOClient = require('socket.io/lib/client');
var IOSocket = require('socket.io/lib/socket');
var IONameSpace = require('socket.io/lib/namespace');
var parser = require('socket.io-parser');
var Adapter = require('socket.io-adapter');
var debug = require('debug')('dynamic.io');
var expandIpv6Address = require("./ipv6");

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
    // var result = pattern.exec(string);
    // // console.log("Is there a match?", pattern)
    // // console.log("string: ", string)
    // console.log("result: ", result);
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
    var arr = string.split(':');
    var portNumber = arr.pop();
    var addr = '';
    for (var i = 0; i < arr.length; i++) {
      if (i === arr.length - 1) {
        addr = addr + arr[i];
      } else {
        addr = addr + ':' + arr[i];
      }
    }
    if (isIpv4(addr)) {
      return string;
    }
    return expandIpv6Address(addr) + ':' + portNumber;
  }
  return string;
}

function isIpv4(string) {
  var ipv4RegEx = new RegExp(/(^\s*((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\s*$)/);
  // console.log(ipv4RegEx.test(string));
  return ipv4RegEx.test(string);
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
  var pattern = makePattern(name);
  if (pattern instanceof RegExp) {
    this._namespacePatterns.push({pattern: pattern, setup: fn});
  } else {
    this._namespaceNames[name] = fn;
  }

  // If there is a matching namespace already, then set it up.
  for (var j in this.nsps) {
    if (this.nsps.hasOwnProperty(j)) {
      var nsp = this.nsps[j];
      var match;
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
  var host = this.getHost(conn);
  if (!host || matchPattern(this._mainHost, extendAddress(host))) {
    host = null;
  }
  var client = new DynamicClient(this, conn, host);
  client.connect('/');
  return this;
}

// Allow users to override this in order to normalize hostnames.
DynamicServer.prototype.getHost = function (conn) {
  return conn.request.headers.host;
}

// Do the work of initializing a namespace when it is needed.
DynamicServer.prototype.initializeNamespace = function (name, host, auto) {
  var fullName = fullNamespaceName(name, host);
  var setup;
  var match;

  if (this._namespaceNames.hasOwnProperty(fullName)) {
    // && this._namespaceNames.hasOwnProperty(fullName)) {
    setup = this._namespaceNames[fullName];
    match = {
      '0': fullName,
      index: 0,
      input: fullName
    };
  } else {
    for (var i = this._namespacePatterns.length - 1; i >= 0; --i) {
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

  var nsp = new DynamicNamespace(this, name, host);

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

    var cleanupTime = delay + +(new Date);
    if (this._cleanupTimer && cleanupTime < this._cleanupTime) {
      clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    delay += Math.max(1, Math.min(delay, 5000));

    if (!this._cleanupTimer) {
      var server = this;
      this._cleanupTime = cleanupTime;
      this._cleanupTimer = setTimeout(function () {
        server._cleanupTimer = null;
        server._cleanupTime = null;
        server.cleanupExpiredNamespaces();
      }, delay);
    }
  }

// When doing cleanup, we scan all namespaces for their
// expiration dates.
DynamicServer.prototype.cleanupExpiredNamespaces = function () {
  var earliestUnexpired = Infinity;
  var now = +(new Date);
  for (var j in this.nsps) {
    if (this.nsps.hasOwnProperty(j)) {
      var nsp = this.nsps[j];
      var expiration = nsp._expiration();
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
  var fullname = fullNamespaceName(name, host);
  if (!this.nsps[fullname]) {
    debug('initializing namespace %s', fullname);
    var nsp = this.initializeNamespace(name, host, fn === true);
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
  var prefix = this._path;
  var clientUrl = prefix + '/socket.io.js';
  var statusUrl = prefix + '/status';
  var evs = srv.listeners('request').slice(0);
  var self = this;
  srv.removeAllListeners('request');
  srv.on('request', function (req, res) {
    if (0 == req.url.indexOf(clientUrl)) {
      self.serve(req, res);
    } else if (self._publicStatus && 0 == req.url.indexOf(statusUrl)) {
      self.serveStatus(req, res);
    } else {
      for (var i = 0; i < evs.length; i++) {
        evs[i].call(srv, req, res);
      }
    }
  });
}

DynamicServer.prototype.serveStatus = function (req, res) {
  debug('serve status');
  var match = '*';
  if (!matchPattern(this._mainHost, req.headers.host)) {
    match = req.headers.host;
  }

  var html = ['<!doctype html>', '<html>', '<body>', '<pre>'];
  html.push('<a href="status">Refresh</a> active namespaces on ' + match, '');
  var sorted = [];
  for (var j in this.nsps) {
    if (this.nsps.hasOwnProperty(j)) {
      var nsp = this.nsps[j];
      if (match != '*' && nsp.host != match) {
        continue;
      }
      sorted.push(j);
    }
  }
  // Sorts by
  sorted.sort(function (a, b) {
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

  var now = +(new Date);
  for (var j = 0; j < sorted.length; ++j) {
    var nsp = this.nsps[sorted[j]];
    html.push(match == '*' ? nsp.fullName() : nsp.name);
    if (nsp.rooms && nsp.rooms.length > 1) {
      html.push('  rooms: ' + nsp.rooms.join(' '));
    }
    if (nsp.sockets.length == 0) {
      var remaining = nsp._expiration() - now;
      var expinfo = '';
      if (remaining < Infinity) {
        expinfo = '; expires ' + remaining / 1000 + 's';
      }
      html.push('  (no sockets' + expinfo + ')');
    } else for (var k = 0; k < nsp.sockets.length; ++k) {
      var socket = nsp.sockets[k];
      var clientdesc = '';
      if (socket.request.connection.remoteAddress) {
        clientdesc += ' from ' + socket.request.connection.remoteAddress;
      }
      var roomdesc = '';
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
DynamicClient = function (server, conn, host) {
    IOClient.apply(this, arguments);
    this.host = host;
}

util.inherits(DynamicClient, IOClient);

/**
 * Add hostname to namespace even if it doesn't exists yet.
 * @param name
 */
DynamicClient.prototype.doConnect = function (name, query) {
  var nsp = this.server.of(name, this.host, true);
  if (nsp == null) {
    this.packet({ type: parser.ERROR, nsp: name, data : 'Invalid namespace'});
    return;
  }
  if (name != '/' && !this.nsps['/']) {
    this.connectBuffer.push(name);
    return;
  }
  var self = this;
  var socket = nsp.add(this, query, function() {
    self.sockets[socket.id] = socket;
    debug('client %s adding socket as self.nsps[%s]', self.id, name);
    self.nsps[name] = socket;
    if (name == '/' && self.connectBuffer.length > 0) {
      self.connectBuffer.forEach(self.connect, self);
      self.connectBuffer = [];
    }
  });
};


/**
 * Extends Socket.io Namespace
 * Start the id at a large number instead of 0
 * Will be deleted if no socket attached to this namespace.
 */

DynamicNamespace = function (server, name, host) {
  IONameSpace.apply(this, arguments);
  this.host = host;
  this.setupDone = 0;
  this.retirement = Infinity;
  this.ids = Math.floor(Math.random() * 1000000000);
  this._expirationTime = Infinity;
  this._expirationCallbacks = null;
}

util.inherits(DynamicNamespace, IONameSpace);

/**
 * Calls the Socket.io remove, which removes a client. Called by each `Socket`.
 * At the end of remove, request cleanup if there are no sockets.
 *
 * @param socket
 */
DynamicNamespace.prototype.remove = function (socket) {
  IONameSpace.prototype.remove.apply(this, arguments);
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
DynamicNamespace.prototype.expire = function (callback) {
  if (callback !== true) {
    if (!this._expirationCallbacks) {
      this._expirationCallbacks = [];
    }
    this._expirationCallbacks.push(callback);
  } else {
    var callbacks = this._expirationCallbacks;
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
DynamicNamespace.prototype.fullname = function () {
  return fullNamespaceName(this.name, this.host);
}

/**
 * If there are no sockets, the namespace will expire after the _expirationTime
 *
 * @returns {number}
 * @private
 */
DynamicNamespace.prototype._expiration = function() {
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
DynamicNamespace.prototype.add = function (client, query, fn) {
  this._expirationTime = Infinity;
  return IONameSpace.prototype.add.apply(this, arguments);
}




exports.DynamicServer = DynamicServer;
exports.DynamicClient = DynamicClient;
exports.DynamicNamespace = DynamicNamespace;
exports.DynamicSocket = IOSocket;

module.exports = exports;

