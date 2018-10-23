var should = require('should');
var http = require('http').Server;
var io = require('..').DynamicServer;
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
    console.log("the srv url is", url);
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
        console.log("doing something")
        should(nsp.fullname()).equal(basename + '/first');
        --total || done();
      })
      srv.listen(function() {
        var addr = srv.address();
        basename = '//' + addr.address + ':' + addr.port;
        console.log("Listening for ", basename);
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
        should(nsp.fullname()).equal(basename + '/first');
        --total || done();
      });
      sio.setupNamespace(/.*second/, function(nsp) {
        should(nsp.fullname()).equal('//localhost/second');
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
        console.log("nsp full name is", nsp.fullname());
        console.log('/first')

        // This test cannot pass because /^\d/ will give a null result when executed
        // because the host address in ipv6 is [::]:portNumber, resulting in the nsp fullname
        // to include the address instead of a null

        should(nsp.fullname()).equal('/first');

        // let str = nsp.fullname();
        // if (str.includes(":::")) {
        //   str = str.replace(":::", "localhost:");
        // }
        // console.log("Did it work", str);
        // should(str).equal(localname + '/first');
        --total || done();
      });
      sio.setupNamespace(/.*second/, function(nsp) {
        should(nsp.fullname()).equal(localname + '/second');
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
})
