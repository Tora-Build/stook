// app.stooks.xyz used to be the app; it is stookstreet.xyz now.
export default { fetch(req) { const u = new URL(req.url); u.hostname = "stookstreet.xyz"; return Response.redirect(u.toString(), 301); } };
