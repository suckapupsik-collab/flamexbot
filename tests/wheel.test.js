import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSectors, findSector } from '../src/features/wheel.js';
test('wheel only displays active weighted prizes',()=>{
 const sectors=buildSectors([{prize_type:'free_spin',is_active:true,weight:1},{prize_type:'addon',is_active:false,weight:4},{prize_type:'coins_10',is_active:true,weight:0}]);
 assert.equal(sectors.length,1);assert.equal(sectors[0].type,'free_spin');
});
test('wheel does not invent a prize when no configured prize is active',()=>{
 const sectors=buildSectors([{prize_type:'addon',is_active:false,weight:10}]);
 assert.equal(sectors.length,1);assert.equal(sectors[0].type,'unavailable');
});
test('wheel finds exact winning sector by type and code',()=>{
 const sectors=buildSectors([{prize_type:'free_spin',prize_code:'spin1',is_active:true},{prize_type:'addon',prize_code:'guard5',is_active:true}]);
 assert.equal(findSector(sectors,{prize_type:'addon'}),1);
 assert.equal(findSector(sectors,{prize_type:'missing',prize_code:'spin1'}),0);
 assert.equal(findSector(sectors,{prize_type:'missing',prize_code:'missing'}),-1);
});
