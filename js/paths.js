// js/paths.js
export function getAppBasePath() {
  // returns "/gottools-admin/" on GitHub Pages, "/" on localhost (if you want)
  const parts = (location.pathname || "/").split("/").filter(Boolean);

  // GitHub pages: /<username>/<repo>/...
  // In your case: /gottools-admin/...
  const repo = parts[0] || ""; 
  return repo ? `/${repo}/` : "/";
}

export function loginUrl() {
  return `${location.origin}${getAppBasePath()}index.html`;
}
