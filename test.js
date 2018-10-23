var expandIPv6Address = require('./ipv6');

if (null) {
  console.log("true")
} else {
  console.log("false")
  console.log(+(new Date));

  // let string = "hellow/\//";
  let string = /^\d/;
  let addr4 = "0.0.0.0:12345";
  let addr6 = ":::12345";
  let local = "localhost:12345";

  console.log('Ipv4', string.exec(addr4));
  console.log('Ipv6', string.exec(addr6));
  console.log('local', string.exec(local));
  console.log('ipv6 expand', expandIPv6Address("::"));
}