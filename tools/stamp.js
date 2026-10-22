/* Stamps index.html's own css/js links with ?v=<time> so phones never mix a cached old file with a new one.
   Run before every commit that changes css/ or js/:  npm run stamp */
const fs = require('fs'), path = require('path');
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
for (const name of ['index.html', 'live.html']) {
  const file = path.join(__dirname, '..', name);
  const html = fs.readFileSync(file, 'utf8').replace(/((?:href|src)="(?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=\w+)?"/g, `$1?v=${v}"`);
  fs.writeFileSync(file, html);
}
console.log('stamped v=' + v + ' (index.html, live.html)');
