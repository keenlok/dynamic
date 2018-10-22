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

describe('test 1', function () {
  it('should add //host:port when host is true', function (done) {
    let srv = http();
    let sio = new io(srv, {host: true});
    let total = 1;
    let basename = '';

    sio.setupNamespace(/.*first/, function (nsp) {
      var full = nsp.fullName();
      var test = 1;
      console.log("doing something")
      should(nsp.fullName()).equal(basename + '/first');
      --total || done();
    })
    srv.listen(function() {
      var addr = srv.address();
      basename = '//' + addr.address + ':' + addr.port;
      console.log("Listening for ", basename);
      client(srv, '/first');
    });
  })
})