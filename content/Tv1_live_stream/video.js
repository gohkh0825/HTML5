// 指向宝塔本机的代理重定向路径，让宝塔去处理防盗链请求头
const manifestUri = 'https://php.gohkh7.eu.org/rtm-cf/live/media0/tv1/HLS/tv1.m3u8?id=1'; 
const licenseServerUrl = 'https://71f2efe7.drm-widevine-licensing.axprod.net/AcquireLicense';
const baseTokenUrl = 'https://php.gohkh7.eu.org/rtm-token/latest/drm/token?kid=';

async function extractKidFromM3u8(m3u8Url) {
  try {
    const response = await fetch(m3u8Url);
    const m3u8Text = await response.text();
    const kidMatch = m3u8Text.match(/KEYID=(0x[A-Fa-f0-9]{32}|[A-Fa-f0-9]{32})/i);
    if (kidMatch) {
      let kid = kidMatch[1];
      return kid.toLowerCase().startsWith('0x') ? kid : '0x' + kid;
    }
    const lines = m3u8Text.split('\n');
    for (let line of lines) {
      line = line.trim();
      if (line && !line.startsWith('#') && line.includes('.m3u8')) {
        return await extractKidFromM3u8(new URL(line, m3u8Url).href); 
      }
    }
    return null;
  } catch (e) { return null; }
}

async function init() {
  const video = document.getElementById('video');
  const player = video['ui'].getControls().getPlayer();

  let drmToken = '';
  const dynamicKid = await extractKidFromM3u8(manifestUri);

  if (dynamicKid) {
    try {
      const response = await fetch(baseTokenUrl + dynamicKid);
      const textData = await response.text(); 
      try {
        const jsonData = JSON.parse(textData);
        drmToken = jsonData.token || jsonData.message || textData; 
      } catch (e) { drmToken = textData.trim(); }
    } catch (e) {}
  }

  player.configure({ drm: { servers: { 'com.widevine.alpha': licenseServerUrl } } });

  player.getNetworkingEngine().registerRequestFilter((type, request) => {
    if (type === shaka.net.NetworkingEngine.RequestType.LICENSE && drmToken) {
      request.headers['x-axdrm-message'] = drmToken;
    }
  });

  try {
    await player.load(manifestUri);
    console.log('🎉 播放成功！');
  } catch (error) {
    console.error('❌ 播放失败:', error);
  }
}

document.addEventListener('shaka-ui-loaded', init);
