// app.stooks.xyz used to be the app; it is stooks.xyz now.
export default { fetch(req) { const u = new URL(req.url); u.hostname = "stooks.xyz"; return Response.redirect(u.toString(), 301); } };
