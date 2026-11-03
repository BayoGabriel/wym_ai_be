const B='http://localhost:3000';
const req=async(m,p,{token,body,headers}={})=>{const r=await fetch(B+p,{method:m,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...headers},body:body?JSON.stringify(body):undefined});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const uniq=Date.now().toString(36);
// 1. ORG SIGNUP
const reg=await req('POST','/api/v1/auth/register',{body:{organizationName:'Greenfield School',email:`admin@greenfield-${uniq}.edu`,password:'GreenPass123!',name:'Principal Demo'}});
console.log('1. signup:',reg.s,reg.j?.organization);
const org=reg.j.organization,tok=reg.j.accessToken;
// 2. PLATFORM ADMIN ASSIGNS WYMASSIST
const pl=await req('POST','/api/v1/auth/login',{body:{email:'qa-super@wymnet.local',password:'QaSuperPass123!'}});
const asg=await req('POST','/api/v1/admin/products/assign',{token:pl.j.accessToken,body:{organizationId:org.id,productCode:'WYMASSIST',status:'active'}});
console.log('2. assign WYMASSIST:',asg.s);
const sub=await req('POST','/api/v1/admin/subscriptions',{token:pl.j.accessToken,body:{organizationId:org.id,productCode:'WYMASSIST',status:'trialing'}});
console.log('   subscription:',sub.s,sub.j?.status);
// 3. CONFIGURE ASSISTANT (as the new client admin)
const cfg=await req('PATCH','/api/v1/assist',{token:tok,body:{assistantName:'Greenie',welcomeMessage:'Hi! Ask me anything about Greenfield School.',leadCaptureEnabled:true,escalationEnabled:true,appointmentRequestsEnabled:true,publicChatEnabled:true,allowedOrigins:['http://localhost:5173'],intakeFields:[{key:'course',label:'Course of interest',type:'select',required:true,options:['Nursing','IT','Business']} ]}});
console.log('3. assist config:',cfg.s,cfg.j?.publicChatEnabled);
await req('PATCH','/api/v1/organizations/settings',{token:tok,body:{businessName:'Greenfield School',contactEmail:'office@greenfield.edu',primaryColor:'#0b5c40'}});
const k=await req('POST','/api/v1/knowledge',{token:tok,body:{title:'Courses & Fees',content:'Greenfield School offers Nursing (2 years, $4,000/yr), IT (3 years, $3,500/yr) and Business Administration (3 years, $3,000/yr). Registration for 2027 opens January 5. Campus tours run every Friday at 10am.',category:'GENERAL',status:'ACTIVE'}});
await req('POST',`/api/v1/knowledge/${k.j.id}/process`,{token:tok});
console.log('4. knowledge processed');
// 5. VISITOR SIDE (the embedded widget flow)
const ORIGIN={Origin:'http://localhost:5173'};
const sess=await req('POST','/api/v1/public/assist/sessions',{body:{organizationSlug:org.slug,visitorName:'Prospective Student'},headers:ORIGIN});
console.log('5. visitor session:',sess.s);
const st=sess.j.sessionToken;
const m1=await req('POST','/api/v1/public/assist/messages',{token:st,body:{content:'How much is the IT course and when does registration open?',clientRequestId:'demo-msg-0001'},headers:ORIGIN});
console.log('6. AI replied:',m1.s,'→',m1.j?.assistantMessage?.content);
const lead=await req('POST','/api/v1/public/assist/leads',{token:st,body:{name:'Demo Student',email:'student@test.dev',consentToContact:true,customFields:{course:'IT'}},headers:ORIGIN});
const ap=await req('POST','/api/v1/public/assist/appointments',{token:st,body:{customerName:'Demo Student',preferredDate:'2026-11-06',preferredTime:'10:00',reason:'Campus tour'},headers:ORIGIN});
const ho=await req('POST','/api/v1/public/assist/handoff',{token:st,body:{reason:'Wants scholarship details'},headers:ORIGIN});
console.log('7. lead:',lead.s,'appt:',ap.s,'handoff:',ho.s);
// 8. STAFF SIDE
const [leads,appts,hoffs,convs]=await Promise.all([req('GET','/api/v1/leads',{token:tok}),req('GET','/api/v1/appointments',{token:tok}),req('GET','/api/v1/handoffs',{token:tok}),req('GET','/api/v1/conversations',{token:tok})]);
console.log('8. staff sees → leads:',leads.j?.items?.length,'appts:',appts.j?.items?.length,'handoffs:',hoffs.j?.items?.length,'conversations:',convs.j?.items?.length);
console.log('ORG_SLUG='+org.slug);
