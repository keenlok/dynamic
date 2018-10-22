if (null) {
  console.log("true")
} else {
  console.log("false")
  console.log(+(new Date));

  // let string = "hellow/\//";
  let string = RegExp('.*');
  console.log('Before', string);
  // string.replace(/ah/g, '\uffff')
  // console.warn('\uffff')
  console.log('After', string);

  console.log(Math.max(0, Infinity || 0));
}