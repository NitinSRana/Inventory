import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCsv } from '../catalog/csv.ts';
import { toCsv, type Report } from './csv.ts';

const report: Report = {
  columns: [
    { key: 'name', label: 'product' },
    { key: 'value', label: 'value', numeric: true },
  ],
  rows: [
    { name: 'Vollmilch 1L', value: '15.80' },
    { name: 'Milch, fettarm', value: '9.50' },
    { name: 'He said "hi"', value: '0' },
    { name: 'two\nlines', value: '1' },
  ],
};

test('round-trips through the parser it will be re-imported by', () => {
  const parsed = parseCsv(toCsv(report, ['Product', 'Value']));
  assert.deepEqual(parsed[0], ['Product', 'Value']);
  assert.deepEqual(parsed[1], ['Vollmilch 1L', '15.80']);
  // The three cases that break a naive join(',').
  assert.deepEqual(parsed[2], ['Milch, fettarm', '9.50']);
  assert.deepEqual(parsed[3], ['He said "hi"', '0']);
  assert.deepEqual(parsed[4], ['two\nlines', '1']);
});

test('emits one header row plus one row per record', () => {
  const parsed = parseCsv(toCsv(report, ['Product', 'Value']));
  assert.equal(parsed.length, report.rows.length + 1);
});

test('a missing cell becomes empty, not undefined', () => {
  const sparse: Report = { columns: report.columns, rows: [{ name: 'Only name' }] };
  assert.equal(toCsv(sparse, ['Product', 'Value']).split('\r\n')[1], 'Only name,');
});
