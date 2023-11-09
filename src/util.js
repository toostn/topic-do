export const matchTopic = (ts,t) => {
  if (ts == "#") {
    return true;
  } else if(ts.startsWith("$share")){
    ts = ts.replace(/^\$share\/[^#+/]+\/(.*)/g,"$1");
  }

  const re = new RegExp("^"+ts.replace(/([\[\]\?\(\)\\\\$\^\*\.|])/g,"\\$1").replace(/\+/g,"[^/]+").replace(/\/#$/,"(\/.*)?")+"$");

  return re.test(t);
}
