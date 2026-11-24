import './about.js';

// Record and emblem supplied by the maintainer. Derived deployments must use
// their own filing information; this is not a live verification of approval.
const policeFiling = {number:'31011202023890',label:'沪公网安备31011202023890号'};

const footer=document.querySelector('.site-footer');
if(footer&&policeFiling&&/^\d{14}$/.test(policeFiling.number)&&policeFiling.label.includes(policeFiling.number)){
  const link=document.createElement('a');link.className='filing-police';
  link.href=`https://beian.mps.gov.cn/#/query/webSearch?code=${policeFiling.number}`;
  link.target='_blank';link.rel='noopener noreferrer';link.title='公安联网备案信息查询（新窗口）';
  const emblem=document.createElement('img');emblem.src='images/police-filing.png';emblem.width=20;emblem.height=20;emblem.alt='公安备案图标';
  const label=document.createElement('span');label.textContent=policeFiling.label;
  link.append(emblem,label);footer.append(link);document.documentElement.classList.add('has-police-filing');
}
