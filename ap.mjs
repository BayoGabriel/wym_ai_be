const B='http://localhost:3000';
const req=async(m,p,{token,body,headers}={})=>{const r=await fetch(B+p,{method:m,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...headers},body:body?JSON.stringify(body):undefined});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const sess=await req('POST','/api/v1/public/assist/sessions',{body:{organizationSlug:'greenfield-school'},headers:{Origin:'http://localhost:5173'}});
const st=sess.j.sessionToken;
const a1=await req('POST','/api/v1/public/assist/appointments',{token:st,body:{customerName:'Demo Student',email:'student@test.dev',preferredDate:'2026-11-06',preferredTime:'10:00',reason:'Campus tour'},headers:{Origin:'http://localhost:5173'}});
console.log('with email:',a1.s,JSON.stringify(a1.j).slice(0,200));
const a2=await req('POST','/api/v1/public/assist/appointments',{token:st,body:{customerName:'No Contact',preferredDate:'2026-11-07',preferredTime:'11:00'},headers:{Origin:'http://localhost:5173'}});
console.log('no contact:',a2.s,JSON.stringify(a2.j).slice(0,300));
