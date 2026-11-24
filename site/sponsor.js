const sponsorUrl='https://afdian.com/a/Redpred?utm_source=copylink&utm_medium=link';
const header=document.querySelector('body > header');
const title=header?.querySelector('h1,.tasks-brand,.brand');

if(header&&title&&!document.getElementById('openSponsor')){
  const button=document.createElement('button');
  button.id='openSponsor';button.className='sponsor-button';button.type='button';
  button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','sponsorDialog');button.setAttribute('aria-expanded','false');
  button.innerHTML='<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><span>赞助</span>';
  // Keep the title and its action together without changing the map header's
  // existing responsive brand visibility or camera controls.
  if(document.body.classList.contains('map-app'))header.querySelector('.brand').after(button);
  else{
    const group=document.createElement('div');group.className='sponsor-title';title.before(group);group.append(title,button);
  }
  header.classList.add('has-sponsor');
  const dialog=document.createElement('dialog');dialog.id='sponsorDialog';dialog.className='sponsor-dialog';
  dialog.setAttribute('aria-labelledby','sponsorTitle');
  dialog.innerHTML=`<div class="sponsor-dialog-head"><h2 id="sponsorTitle">赞助支持</h2><button type="button" data-close aria-label="关闭赞助窗口">×</button></div>
    <p class="sponsor-intro">感谢你支持塔科夫物资地图的开发与维护。</p>
    <div class="sponsor-panels">
    <section class="sponsor-channel sponsor-channel-wechat" aria-labelledby="sponsorWechatTitle"><h3 id="sponsorWechatTitle">微信</h3>
      <a class="sponsor-image-link sponsor-payment-image" href="images/sponsor-wechat.png" data-preview="微信收款码" aria-label="放大微信收款码"><img class="sponsor-image" src="images/sponsor-wechat.png" width="583" height="591" alt="Redpred 提供的微信赞助收款码" loading="lazy" decoding="async"><span>点击查看大图</span></a>
      <p class="sponsor-channel-hint">使用微信扫描二维码赞助</p>
    </section>
    <section class="sponsor-channel sponsor-channel-alipay" aria-labelledby="sponsorAlipayTitle"><h3 id="sponsorAlipayTitle">支付宝</h3>
      <a class="sponsor-image-link sponsor-payment-image" href="images/sponsor-alipay.jpg" data-preview="支付宝收款码" aria-label="放大支付宝收款码"><img class="sponsor-image" src="images/sponsor-alipay.jpg" width="705" height="716" alt="Redpred 提供的支付宝赞助收款码" loading="lazy" decoding="async"><span>点击查看大图</span></a>
      <p class="sponsor-channel-hint">使用支付宝扫描二维码赞助</p>
    </section>
    <section class="sponsor-channel sponsor-channel-afdian" aria-labelledby="sponsorAfdianTitle"><h3 id="sponsorAfdianTitle">爱发电</h3>
      <a class="sponsor-image-link" href="images/afdian-Redpred.jpg" data-preview="爱发电赞助二维码" aria-label="放大爱发电赞助二维码"><img class="sponsor-image" src="images/afdian-Redpred.jpg" width="750" height="1024" alt="Redpred 的爱发电赞助二维码" loading="lazy" decoding="async"><span>点击查看大图</span></a>
      <a class="sponsor-link" href="${sponsorUrl}" target="_blank" rel="noopener noreferrer" aria-label="打开 Redpred 的爱发电赞助页面（新标签页）">打开爱发电主页 ↗</a>
      <button type="button" class="sponsor-copy">复制爱发电链接</button>
      <p class="sponsor-copy-status" role="status" aria-live="polite"></p>
    </section></div>`;
  document.body.append(dialog);
  const copy=dialog.querySelector('.sponsor-copy'),status=dialog.querySelector('.sponsor-copy-status');
  const preview=document.createElement('dialog');preview.id='sponsorPreview';preview.className='sponsor-preview';preview.setAttribute('aria-labelledby','sponsorPreviewTitle');
  preview.innerHTML='<div class="sponsor-dialog-head"><h2 id="sponsorPreviewTitle"></h2><button type="button" data-close aria-label="关闭二维码大图" autofocus>×</button></div><img alt="">';
  document.body.append(preview);let previewOpener=null;
  for(const link of dialog.querySelectorAll('[data-preview]'))link.addEventListener('click',event=>{
    event.preventDefault();previewOpener=link;
    preview.querySelector('h2').textContent=link.dataset.preview;
    const image=preview.querySelector('img');image.src=link.querySelector('img').src;image.alt=link.querySelector('img').alt;
    if(!preview.open)preview.showModal();
  });
  preview.querySelector('[data-close]').addEventListener('click',()=>preview.close());
  preview.addEventListener('close',()=>{if(dialog.open)previewOpener?.focus({preventScroll:true});});
  preview.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
  preview.addEventListener('click',event=>{
    if(event.target!==preview)return;const bounds=preview.getBoundingClientRect();
    if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)preview.close();
  });
  button.onclick=()=>{
    status.textContent='';copy.textContent='复制爱发电链接';
    if(!dialog.open)dialog.showModal();button.setAttribute('aria-expanded','true');
  };
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{if(preview.open)preview.close();button.setAttribute('aria-expanded','false');button.focus({preventScroll:true});});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;const bounds=dialog.getBoundingClientRect();
    if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();
  });
  function copyFallback(){
    const input=document.createElement('textarea');input.value=sponsorUrl;input.readOnly=true;input.className='sponsor-copy-buffer';dialog.append(input);
    try{input.select();input.setSelectionRange(0,sponsorUrl.length);return document.execCommand('copy');}
    finally{input.remove();copy.focus({preventScroll:true});}
  }
  copy.onclick=async()=>{
    copy.disabled=true;let copied=false;
    try{await navigator.clipboard.writeText(sponsorUrl);copied=true;}
    catch{try{copied=copyFallback();}catch{}}
    finally{copy.disabled=false;if(dialog.open)copy.focus({preventScroll:true});}
    copy.textContent=copied?'已复制':'复制爱发电链接';
    status.textContent=copied?'链接已复制，可粘贴分享。':'自动复制失败，请长按或右键上方链接复制。';
  };
}
