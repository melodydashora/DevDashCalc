import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleDocumentLink, readLinkedDocument } from '../linked-documents.js';
const href='https://docs.google.com/document/d/abcdefghijklmnop/edit?usp=sharing';
test('only established Google document shapes qualify, with canonical links stripping tracking parameters',()=>{
  assert.equal(googleDocumentLink(href).href,'https://docs.google.com/document/d/abcdefghijklmnop/edit');
  for(const bad of ['http://docs.google.com/document/d/abcdefghijklmnop/edit', 'https://docs.google.com.evil.test/document/d/abcdefghijklmnop/edit', 'https://user:secret@docs.google.com/document/d/abcdefghijklmnop/edit', href+'&token=secret','https://docs.google.com/spreadsheets/d/abcdefghijklmnop/edit',href.replace('/edit','/../../x')]) assert.equal(googleDocumentLink(bad),null);
});
test('text export follows only Google docstext redirects without any app credentials',async()=>{
  const calls=[];
  const out=await readLinkedDocument({href,title:'Assessment plan',courseId:'42'},{fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return calls.length===1?new Response(null,{status:307,headers:{location:'https://doc-0c-18-docstext.googleusercontent.com/export/example'}}):new Response('9/15: Product and quotient rules',{headers:{'content-type':'text/plain; charset=utf-8'}});
  }});
  assert.equal(out.body,'9/15: Product and quotient rules'); assert.equal(out.contentStatus,'available'); assert.equal(out.dueAtPresent,false);
  assert.equal(calls.length,2); assert.ok(calls.every(c=>!c.options.headers.authorization&&c.options.credentials==='omit'&&c.options.redirect==='manual'));
});
test('inaccessible and unexpected documents remain unread, and a bad redirect cannot trigger a request',async()=>{
  let calls=0;
  await assert.rejects(readLinkedDocument({href},{fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/secret'}});}}));
  assert.equal(calls,1);
  for(const response of [new Response('login',{status:401}),new Response('<html>login</html>',{headers:{'content-type':'text/html'}})]) await assert.rejects(readLinkedDocument({href},{fetchImpl:async()=>response}));
});
test('oversized document bodies are bounded and explicitly shortened',async()=>{
  const out=await readLinkedDocument({href},{maxBytes:8,fetchImpl:async()=>new Response('abcdefghijklmnop',{headers:{'content-type':'text/plain'}})});
  assert.equal(out.body,'abcdefgh'); assert.equal(out.contentStatus,'truncated');
});
