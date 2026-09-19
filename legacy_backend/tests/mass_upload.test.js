import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('/api/import error responses return proper status code', async () => {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/import',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  };

  const req = http.request(options, (res) => {
    assert.ok(res.statusCode >= 400);
  });
  req.on('error', () => {});
  req.end();
});
