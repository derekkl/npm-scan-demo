const express = require('express');
const _ = require('lodash');
const minimist = require('minimist');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse any CLI args passed to the process (uses the vulnerable minimist dependency)
const args = minimist(process.argv.slice(2));

app.get('/', (req, res) => {
  res.json({
    message: 'npm-scan-demo is running',
    startedWithArgs: args,
  });
});

// Uses lodash.merge — the specific function implicated in lodash's
// prototype-pollution CVEs (e.g. CVE-2018-16487, CVE-2019-10744) on
// versions before 4.17.11 / 4.17.19 respectively.
app.get('/merge-demo', (req, res) => {
  const base = { a: 1, b: 2 };
  const merged = _.merge({}, base, { c: 3 });
  res.json({ merged });
});

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`npm-scan-demo listening on port ${PORT}`);
});
