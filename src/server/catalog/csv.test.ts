import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapHeaders, parseCsv, unwrapDoubleEncoded } from './csv.ts';

test('parses a plain file', () => {
  assert.deepEqual(parseCsv('name,ean\nMilk,123\nBread,456'), [
    ['name', 'ean'],
    ['Milk', '123'],
    ['Bread', '456'],
  ]);
});

test('keeps commas inside quoted fields', () => {
  // The whole reason this is not a String.split.
  assert.deepEqual(parseCsv('name,ean\n"Milch, fettarm 1L",4001234567890'), [
    ['name', 'ean'],
    ['Milch, fettarm 1L', '4001234567890'],
  ]);
});

test('handles escaped quotes and embedded newlines', () => {
  assert.deepEqual(parseCsv('name\n"He said ""hi"""\n"two\nlines"'), [
    ['name'],
    ['He said "hi"'],
    ['two\nlines'],
  ]);
});

test('accepts CRLF and a UTF-8 BOM from Excel', () => {
  assert.deepEqual(parseCsv('﻿name,ean\r\nMilk,123\r\n'), [
    ['name', 'ean'],
    ['Milk', '123'],
  ]);
});

test('drops trailing blank lines', () => {
  assert.equal(parseCsv('name\nMilk\n\n\n').length, 2);
});

test('preserves empty fields in the middle of a row', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,,3'), [
    ['a', 'b', 'c'],
    ['1', '', '3'],
  ]);
});

test('maps headers regardless of case, spacing or punctuation', () => {
  const { index } = mapHeaders(['Product Name', ' EAN ', 'Cost_Price', 'Sell price']);
  assert.equal(index.name, 0);
  assert.equal(index.gtin, 1);
  assert.equal(index.costPrice, 2);
  assert.equal(index.sellPrice, 3);
});

test('ignores columns it does not recognise, but names them', () => {
  const { index, unknown } = mapHeaders(['name', 'shelf location', 'notes']);
  assert.deepEqual(index, { name: 0 });
  // The whole point: "Retail Price" spelled some way no alias covers used to
  // vanish, and the shop found out at the till on a product priced null.
  assert.deepEqual(unknown, ['shelf location', 'notes']);
});

test('a recognised header is never reported as unknown, even repeated', () => {
  const { unknown } = mapHeaders(['ean', 'barcode']);
  assert.deepEqual(unknown, []);
});

test('an empty trailing header is a formatting artefact, not a column', () => {
  const { unknown } = mapHeaders(['name', 'ean', '']);
  assert.deepEqual(unknown, []);
});

test('first matching column wins when a header repeats', () => {
  const { index } = mapHeaders(['ean', 'barcode']);
  assert.equal(index.gtin, 0);
});

test('maps case/outer barcode and pack size, distinct from the unit barcode', () => {
  const { index } = mapHeaders(['Code', 'Description', 'Outer Barcode', 'Unit Barcode']);
  assert.equal(index.sku, 0);
  assert.equal(index.name, 1);
  assert.equal(index.caseGtin, 2);
  assert.equal(index.gtin, 3);
});

test('accepts semicolon separators, as German Excel writes', () => {
  assert.deepEqual(parseCsv('name;ean\nMilch;123'), [
    ['name', 'ean'],
    ['Milch', '123'],
  ]);
});

test('a decimal comma survives a semicolon-separated file', () => {
  // German Excel: ";" separates fields, "," is the decimal point. Treating both
  // as delimiters shears 0,79 into two fields and imports a null price.
  assert.deepEqual(parseCsv('name;cost\nMilch;0,79'), [
    ['name', 'cost'],
    ['Milch', '0,79'],
  ]);
});

test('a semicolon inside a comma-separated file is just text', () => {
  assert.deepEqual(parseCsv('name,note\nMilk,a;b'), [
    ['name', 'note'],
    ['Milk', 'a;b'],
  ]);
});

test('a bare inch mark is literal text, not the start of a quoted field', () => {
  // Real names from this catalogue. A wholesaler export writes the inch mark
  // bare; RFC 4180 would have it doubled, but nobody tells the wholesaler.
  assert.deepEqual(parseCsv('name,sku\n10" BAMBOO STEAMER,L901116'), [
    ['name', 'sku'],
    ['10" BAMBOO STEAMER', 'L901116'],
  ]);
});

test('one bare quote does not swallow the rest of the file', () => {
  // What it used to do: the quote opened a field that never closed, so every
  // delimiter and newline after it became literal and three rows arrived as
  // one. This is the assertion that would have caught it.
  const rows = parseCsv(
    ['name,sku', '10" BAMBOO STEAMER,L901116', 'PLAIN PRODUCT,ABC1', 'ANOTHER,ABC2'].join('\n'),
  );
  assert.equal(rows.length, 4, 'header and three rows');
  assert.deepEqual(rows[2], ['PLAIN PRODUCT', 'ABC1']);
  assert.deepEqual(rows[3], ['ANOTHER', 'ABC2']);
});

test('a properly doubled quote is still unescaped', () => {
  // The well-formed spelling of the same name must keep working.
  assert.deepEqual(parseCsv('name\n"10"" BAMBOO STEAMER"'), [['name'], ['10" BAMBOO STEAMER']]);
});

test('a quoted field containing a delimiter still holds together', () => {
  assert.deepEqual(parseCsv('name,sku\n"Milch, fettarm",MF1L'), [
    ['name', 'sku'],
    ['Milch, fettarm', 'MF1L'],
  ]);
});

test('a field encoded twice is unwrapped to what the shop meant', () => {
  // Exactly what parsing line 1379 of this shop's export produces.
  assert.equal(
    unwrapDoubleEncoded('"10"""" BAMBOO STEAMER (25.4CM) 30PCS"'),
    '10" BAMBOO STEAMER (25.4CM) 30PCS',
  );
  assert.equal(
    unwrapDoubleEncoded('"5"""" STEAMER PAPER 20x120g (350PCS) BAG"'),
    '5" STEAMER PAPER 20x120g (350PCS) BAG',
  );
});

test('a correctly encoded field is left exactly alone', () => {
  // The same file has both spellings, so the no-op case is the one that must
  // not regress: an inch mark is an ODD run of quotes and stays put.
  assert.equal(unwrapDoubleEncoded('RICE VERMICELLI 4" 15kg'), 'RICE VERMICELLI 4" 15kg');
  assert.equal(unwrapDoubleEncoded('Milch, fettarm 1L'), 'Milch, fettarm 1L');
  assert.equal(unwrapDoubleEncoded(''), '');
  assert.equal(unwrapDoubleEncoded('1.29'), '1.29');
});

test('a name truncated upstream is not guessed at', () => {
  // Opens with a quote and never closes: the rest was lost before the file was
  // written, and inventing an ending would be worse than leaving it visible.
  const truncated = '"LL MOCHI - ASSORTED TROPICAL FRUIT (PINEAPPLE';
  assert.equal(unwrapDoubleEncoded(truncated), truncated);
});
