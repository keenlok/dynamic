var io = require("./index").DynamicServer;
var ioc = require('socket.io-client');
var http = require('http').Server;
var sio = require('socket.io');

// creates a socket.io client for the given server
// creates a socket.io client for the given server
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
//
// if (null) {
//   console.log("true")
// } else {
//   console.log("false")
//   console.log(+(new Date));
//
//   // let string = "hellow/\//";
//   let string = /^\d/;
//   let addr4 = "0.0.0.0:12345";
//   let addr6 = ":::12345";
//   let local = "localhost:12345";
//
//   console.log('Ipv4', string.exec(addr4));
//   console.log('Ipv6', string.exec(addr6));
//   console.log('local', string.exec(local));
//   console.log('ipv6 expand', expandIPv6Address("::"));
// }


let httpSrv = http();
let srv = sio(httpSrv);
srv.set('authorization', function(o, f) { f(null, true); });

srv.on('connect', (s) => {
  console.log("Connected to client", s.client.id);
  console.log(s.constructor.name, s.client.constructor.name);
  console.log(s.nsp.constructor.name, s.nsp.fns.toString());
  s.on('yoyo', (data) => {
    console.log(data);
  })
})

let socket = client(httpSrv);
socket.on('connect', () => {
  socket.emit('yoyo', 'data');
  console.log("connected to srv");
  console.log("My id is", socket.id);
})

// let dynamicSrv = io(httpSrv);
// dynamicSrv.on('connect', s => {
//   console.log("Connected to client", s.client.id);
//   console.log(s);
//   s.on('yoyo', data => {
//     console.log("receiving data ", data);
//   })
// })



// var httpSrv = http();
// var srv = io(httpSrv);
// srv.set('authorization', function(o, f) { f(null, true); });
//
// srv.on('connection', function(s) {
//   console.log("the connected socket id", s.id);
//   console.warn(s.client.id);
//   s.on('yoyo', function(data) {
//     console.log(data);
//   });
// });
//
// // var socket = client(srv.httpServer);
// var socket = client(httpSrv);
// socket.on('connect', function(){
//   socket.emit('yoyo', 'data');
//   console.log("connected", socket);
// });
//
// socket.on('error', function(err) {
//   console.log(err);
// });