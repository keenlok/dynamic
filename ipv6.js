// [JS] Expand Abbreviated IPv6 Addresses
// by Christopher Miller
// http://forrst.com/posts/JS_Expand_Abbreviated_IPv6_Addresses-1OR
// Modified to work with embedded IPv4 addresses
// Author: Mottie, Rob Garrison
function expandIPv6Address(address) {
  var fullAddress = "";
  var expandedAddress = "";
  var validGroupCount = 8;
  var validGroupSize = 4;

  var ipv4 = "";
  var extractIpv4 = /([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/;
  var validateIpv4 = /((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})/;

  // look for embedded ipv4
  if(validateIpv4.test(address))
  {
    groups = address.match(extractIpv4);
    for(var i=1; i<groups.length; i++)
    {
      ipv4 += ("00" + (parseInt(groups[i], 10).toString(16)) ).slice(-2) + ( i==2 ? ":" : "" );
    }
    address = address.replace(extractIpv4, ipv4);
  }

  if(address.indexOf("::") == -1) // All eight groups are present.
    fullAddress = address;
  else // Consecutive groups of zeroes have been collapsed with "::".
  {
    var sides = address.split("::");
    var groupsPresent = 0;
    for(var i=0; i<sides.length; i++)
    {
      groupsPresent += sides[i].split(":").length;
    }
    fullAddress += sides[0] + ":";
    for(var i=0; i<validGroupCount-groupsPresent; i++)
    {
      fullAddress += "0000:";
    }
    fullAddress += sides[1];
  }
  var groups = fullAddress.split(":");
  for(var i=0; i<validGroupCount; i++)
  {
    while(groups[i].length < validGroupSize)
    {
      groups[i] = "0" + groups[i];
    }
    expandedAddress += (i!=validGroupCount-1) ? groups[i] + ":" : groups[i];
  }
  return expandedAddress;
}
exports.expandIPv6Address = expandIPv6Address;
module.exports = expandIPv6Address;
