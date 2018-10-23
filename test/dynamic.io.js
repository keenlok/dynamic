var should = require('should');
var expect = require('expect.js');
var http = require('http').Server;
var io = require('../index').DynamicServer;
var socket = require('../index').DynamicSocket;
var ioc = require('socket.io-client');

// creates a socket.io client for the given server
function client(srv, nsp, opts){
  if ('object' == typeof nsp) {
    opts = nsp;
    nsp = null;
  }
  var url;
  if ('string' == typeof srv) {
    url = srv + (nsp || '');
  } else {
    var addr = srv.address();
    // Adding the brackets so that when the client parses the address, the port will
    // be separated --> see socket.op-client parse id
    if (addr.address === "::") {
      addr.address = '['+addr.address+']';
    }
    if (!addr) addr = srv.listen().address();
    url = 'ws://' + addr.address + ':' + addr.port + (nsp || '');
    // console.log("the srv url is", url);
  }
  let clien = ioc(url, opts);
  // console.log("what is the ioclient", clien);
  return clien;
}

describe('dynamic.io', function () {
  describe('host', function () {
    it('should add //host:port when host is true', function (done) {
      let srv = http();
      let sio = new io(srv, {host: true});
      let total = 1;
      let basename = '';
      sio.setupNamespace(/.*first/, function (nsp) {
        expect(nsp.fullname()).to.be(basename + '/first');
        --total || done();
      })
      srv.listen(function() {
        var addr = srv.address();
        basename = '//' + addr.address + ':' + addr.port;
        client(srv, '/first');
      });
    });
    it('should allow getHost override', function(done){
      var srv = http();
      var sio = io(srv, { host: true });
      var total = 2;
      var basename = '';
      // Override getHost to strip port.
      sio.getHost = function(conn) {
        return conn.request.headers.host.replace(/:\d+$/, '');
      }
      sio.setupNamespace(/.*first/, function(nsp) {
        expect(nsp.fullname()).to.be(basename + '/first');
        --total || done();
      });
      sio.setupNamespace(/.*second/, function(nsp) {
        expect(nsp.fullname()).to.be('//localhost/second');
        --total || done();
      });
      srv.listen(function() {
        var addr = srv.address();
        basename = '//' + addr.address;
        client(srv, '/first');
        client('http://localhost:' + addr.port + '/second');
      });
    });
    it('should support host pattern', function(done){
      var srv = http();
      var sio = io(srv, { host: /^\d/ });
      var total = 2;
      var localname = '';

      sio.setupNamespace(/.*first/, function(nsp) {
        // This test cannot pass because /^\d/ will give a null result when executed
        // because the host address in ipv6 is [::]:portNumber, resulting in the nsp fullname
        // to include the address instead of a null
        expect(nsp.fullname()).to.be('/first');
        --total || done();
      });
      sio.setupNamespace(/.*second/, function(nsp) {
        expect(nsp.fullname()).to.be(localname + '/second');
        --total || done();
      });
      srv.listen(function() {
        var addr = srv.address();
        localname = '//localhost:' + addr.port;
        client(srv, '/first');
        client('http://localhost:' + addr.port + '/second');
      });
    });
  });

  describe('namespaces', function(){
    var Socket = socket;
    it('should set up / with *', function(done){
      var srv = http();
      var sio = io(srv);
      var total = 1;
      sio.setupNamespace('*', function(nsp, match) {
        // should(nsp).equal(sio.sockets);
        // I'm not sure what groups: undefined is, all the RegExp.exec() returns the array with
        // this property
        expect(match).to.eql({'0': '/', index: 0, input: '/', groups: undefined});
        expect(nsp).to.be(sio.sockets);
        --total || done();
      });
    });
    it('should set up / with /', function(done){
      var srv = http();
      var sio = io(srv);
      var total = 1;
      sio.setupNamespace('/', function(nsp, match) {
        // console.log(match);
        expect(match).to.eql({'0': '/', index: 0, input: '/'});
        expect(nsp).to.be(sio.sockets);
        --total || done();
      });
    });
    it('should match namespace regexp', function(done){
      var srv = http();
      var sio = io(srv);
      var setup = 2;
      var connect = [];
      sio.setupNamespace(/^.*\/([^\/]*)$/, function(nsp, match){
        expect(match).to.eql(
          setup == 2 ? {'0': '/', '1': '', index: 0, input: '/', groups: undefined} :
            setup == 1 ? {'0':'/d/sec', '1': 'sec', index: 0, input: '/d/sec', groups: undefined} :
              null);
        expect(nsp.name).to.be(match[0]);
        expect(nsp.fullname()).to.be(match[0]);
        if (setup == 2) {
          expect(nsp).to.be(sio.sockets);
        } else {
          expect(nsp).not.to.be(sio.sockets);
        }
        --setup;
        nsp.on('connect', function(socket) {
          expect(socket).to.be.a(Socket);
          connect.push(socket.nsp.name);
          if (connect.length == 2) {
            expect(connect).to.contain('/');
            expect(connect).to.contain('/d/sec');
            done();
          }
        });
      });
      srv.listen(function() {
        expect(setup).to.be(1);
        var sec = client(srv, '/d/sec');
      });
    });
    it('should not match restrictive regexp', function(done){
      var srv = http();
      var sio = io(srv);
      var connect = 1;
      sio.setupNamespace(/^\/dyn\/([^\/]*)$/, function(nsp, match){
        expect(nsp).not.to.be(sio.sockets);
        expect(nsp.name).to.be('/dyn/a');
        expect(match[1]).to.be('a');
        nsp.on('connect', function(socket) {
          --connect || done();
        });
      });
      srv.listen(function() {
        var r = client(srv, '/');
        r.on('connect', function() {
          expect(connect).to.be(1);
          var e = client(srv, '/doesnotexist');
          e.on('error', function(err) {
            expect(err).to.be('Invalid namespace');
            var a = client(srv, '/dyn/a');
          });
        });
      });
    });
    it('should prioritize names over patterns, last first', function(done){
      var srv = http();
      var sio = io(srv);
      var steps = 5;
      var setup = [];
      sio.setupNamespace('/special-debug', function(nsp, match){S
        setup.push('ex1:' + nsp.name);
        --steps || finish();
      });
      sio.setupNamespace('/special-debug', function(nsp, match){
        setup.push('ex2:' + nsp.name);
        --steps || finish();
      });
      sio.setupNamespace(/^\/special.*$/, function(nsp, match){
        setup.push('wc1:' + nsp.name);
        --steps || finish();
      });
      sio.setupNamespace(/^\/.*debug$/, function(nsp, match){
        setup.push('wc2:' + nsp.name);
        --steps || finish();
      });
      srv.listen(function() {
        client(srv, '/special-debug');
        client(srv, '/special-other');
        client(srv, '/other-debug');
        client(srv, '/special-other-debug');
        var e = client(srv, '/no-match');
        e.on('error', function() {
          setup.push('error:/no-match');
          --steps || finish();
        });
      });
      function finish() {
        expect(setup).to.have.length(5);
        expect(setup).to.contain('ex2:/special-debug');
        expect(setup).to.contain('wc1:/special-other');
        expect(setup).to.contain('wc2:/other-debug');
        expect(setup).to.contain('wc2:/special-other-debug');
        expect(setup).to.contain('error:/no-match');
        done();
      }
    });
    it('should not setup namespace twice', function(done){
      var srv = http();
      var sio = io(srv);
      var steps = 5;
      var setup = [];
      var hello = sio.of('/hello');
      var there = sio.of('/there');
      sio.setupNamespace('/hello', function(nsp, match){
        setup.push('ex1:' + nsp.name);
        --steps || finish();
      });
      sio.setupNamespace('/howdy', function(nsp, match){
        setup.push('ex2:' + nsp.name);
        --steps || finish();
      });
      sio.setupNamespace(/^\/.*h.*$/, function(nsp, match){
        setup.push('wc:' + nsp.name);
        --steps || finish();
      });
      srv.listen(function() {
        var c1 = client(srv, '/howdy');
        c1.on('connect', function() {
          --steps || finish();
        });
        var c2 = client(srv, '/howdy');
        c2.on('connect', function() {
          --steps || finish();
        });
      });
      function finish() {
        expect(setup).to.have.length(3);
        // No duplicates.
        expect(setup).to.contain('ex1:/hello');
        expect(setup).to.contain('ex2:/howdy');
        expect(setup).to.contain('wc:/there');
        done();
      }
    });
    it('should retire stale namespaces', function(done) {
      var srv = http();
      var sio = io(srv, {retirement: 1});
      var steps = 7;
      var setup = [];
      var count = 1;
      sio.setupNamespace(/^\/dyn\/.*$/, function (nsp, match) {
        setup.push('setup:' + nsp.name);
        console.log("setup:"+nsp.name + " "+ count++);
        --steps || finish();
        nsp.on('connect', function (socket) {
          // console.log("What is socket", socket);
          setup.push('sconn:' + nsp.name);
          console.log("sconn:"+nsp.name + " "+ count++);
          --steps || finish();
          // console.log("what listeners does socket have before", socket.listeners('disconnect'));
          socket.on('disconnect', function (reason) {
            console.log(reason);
            setup.push('disc:' + nsp.name);
            console.log("disc:"+nsp.name + " "+ count++);
            --steps || finish();
          });
          // console.warn("what listeners does this socket "+socket.nsp.name +" "+socket.id+" have", socket.listeners('disconnect'));
        });
        nsp.expire(function () {
          setup.push('exp:' + nsp.name);
          console.log("push exp:"+nsp.name+ " "+ count++);
          --steps || finish();
        });
      });
      sio.of('/permanent').on('connect', function (socket) {
        setup.push('sconn:/permanent');
        console.log("sconn:/permanent"+ " "+ count++);
        --steps || finish();
        // console.warn("Socket name", socket.nsp.name, socket.id, socket.listeners('disconnect'));
      });
      srv.listen(function () {
        var c1 = client(srv, '/dyn/fleeting');
        c1.on('connect', function () {
          setup.push('conn:/dyn/fleeting');
          console.log("conn:/dyn/fleeting"+ " "+ count++);
          --steps || finish();
          var c2 = client(srv, '/permanent');
          c2.on('connect', function () {
            setup.push('conn:/permanent');
            console.log("conn:/permanent"+ " "+ count++);
            --steps || finish();
            // console.warn("what are these before disconnect", c2);
            // console.log(c1);
            c2.disconnect();
            c1.disconnect();
            // console.log("what are these before disconnect", c2);
            // console.warn(c1);
            // console.log(this.listeners('disconnect'));
          });
        });
      });

      function finish () {
        console.log("Finish?", setup);
        expect(setup).to.have.length(7);
        // No duplicates.
        expect(setup).to.contain('setup:/dyn/fleeting');
        expect(setup).to.contain('conn:/dyn/fleeting');
        expect(setup).to.contain('sconn:/dyn/fleeting');
        expect(setup).to.contain('sconn:/permanent');
        expect(setup).to.contain('conn:/permanent');
        expect(setup).to.contain('disc:/dyn/fleeting');
        expect(setup).to.contain('exp:/dyn/fleeting');
        expect(sio.nsps).to.have.property('/permanent');
        done();
      }
    });
  });
})
