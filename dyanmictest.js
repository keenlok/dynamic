var io = require("./index").DynamicServer;
var ioc = require('socket.io-client');
var http = require('http').Server;
var sio = require('socket.io');
var IOSocket = require("./index").DynamicSocket;

function client(srv, nsp, opts){
  console.log("HELLLO")
  if ('object' == typeof nsp) {
    opts = nsp;
    nsp = null;
  }
  var addr = srv.address();
  console.log("What is my", addr);
  if (!addr) addr = srv.listen().address();
  console.log("What is my", addr);
  // Adding the brackets so that when the client parses the address, the port will
  // be separated --> see socket.op-client parse id
  if (addr.address === "::") {
    addr.address = '['+addr.address+']';
  }
  var url = 'ws://' + addr.address + ':' + addr.port + (nsp || '');
  console.log(url);
  return ioc(url, opts);
}

let httpSrv = http();

let socket = client(httpSrv);
socket.on('connect', () => {
  socket.emit('yoyo', 'data');
  console.log("connected to srv");
  console.log("My id is", socket.id);
  console.log("my instance: ", socket.constructor.name);
})

let dynamicSrv = io(httpSrv);
dynamicSrv.set('authorization', function(o, f) { f(null, true); });

dynamicSrv.on('connect', s => {
  console.log("Connected to client", s.client.id);
  console.log(s.constructor.name, s.client.constructor.name);
  // console.log(s.client.sockets);

  s.on('yoyo', data => {
    console.log("receiving data ", data);
  })
})
