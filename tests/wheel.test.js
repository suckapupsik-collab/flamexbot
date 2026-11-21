import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSectors, findSector } from '../src/features/wheel.js';

test('wheel keeps only active weighted prizes',()=>{
  const sectors=buildSectors([
    {prize_type:'free_spin',prize_code:'wheel_spin_1',prize_label:'Бесплатная прокрутка',is_active:true,weight:5},
    {prize_type:'addon',prize_code:'command_protection_5d',prize_label:'Защита',is_active:false,weight:10},
  ]);
  assert.equal(sectors.length,1);
  assert.equal(sectors[0].type,'free_spin');
  assert.equal(sectors[0].code,'wheel_spin_1');
});
test('wheel maps the exact prize by type and then code',()=>{
  const sectors=buildSectors([
    {prize_type:'free_spin',prize_code:'wheel_spin_1',prize_label:'Бесплатная прокрутка',is_active:true},
    {prize_type:'addon',prize_code:'command_protection_5d',prize_label:'Защита',is_active:true},
  ]);
  assert.equal(findSector(sectors,{prize_type:'addon'}),1);
  assert.equal(findSector(sectors,{prize_type:'unknown',prize_code:'wheel_spin_1'}),0);
  assert.equal(findSector(sectors,{prize_type:'missing',prize_code:'missing',prize_label:'missing'}),-1);
});
test('wheel shows a disabled placeholder when every prize is inactive',()=>{
  const sectors=buildSectors([{prize_type:'addon',is_active:false,weight:20},{prize_type:'free_spin',is_active:false,weight:10}]);
  assert.equal(sectors.length,1);
  assert.equal(sectors[0].type,'unavailable');
});
test('wheel uses defaults only when explicitly requested',()=>{
  const sectors=buildSectors([],{fallbackOnEmpty:true});
  assert.equal(sectors.length,9);
  assert.ok(sectors.some(sector=>sector.type==='free_spin'));
});
