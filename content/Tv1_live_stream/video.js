// ==========================================
// 全局配置 (请替换为你真实的频道 m3u8 链接)
// ==========================================
const manifestUri = 'https://d25tgymtnqzu8s.cloudfront.net/live/media0/tv1/HLS/tv1.m3u8?id=1'; 
const licenseServerUrl = 'https://71f2efe7.drm-widevine-licensing.axprod.net/AcquireLicense';
const baseTokenUrl = 'https://rtm-player.glueapi.io/latest/drm/token?kid=';

// ==========================================
// 辅助函数：自动从 M3U8 文件中提取 kid (支持 Master 和 Media 列表解析)
// ==========================================
async function extractKidFromM3u8(m3u8Url) {
  try {
    console.log('正在解析 m3u8 寻找 kid:', m3u8Url);
    const response = await fetch(m3u8Url);
    const m3u8Text = await response.text();

    // 1. 尝试直接在当前文件中寻找 KEYID
    const kidMatch = m3u8Text.match(/KEYID=(0x[A-Fa-f0-9]{32}|[A-Fa-f0-9]{32})/i);
    if (kidMatch) {
      let kid = kidMatch[1];
      if (!kid.toLowerCase().startsWith('0x')) {
        kid = '0x' + kid;
      }
      console.log('🎯 成功提取到 kid:', kid);
      return kid;
    }

    // 2. 如果没找到，说明这是一个 Master Playlist (主列表)
    // 自动寻找并进入子列表去抓取
    const lines = m3u8Text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('#') && line.includes('.m3u8')) {
        const subPlaylistUrl = new URL(line, m3u8Url).href;
        console.log('📂 发现主列表，正在自动进入子列表抓取:', subPlaylistUrl);
        return await extractKidFromM3u8(subPlaylistUrl); 
      }
    }

    console.warn('没有找到 KEYID，该频道可能未加密，或者格式不支持。');
    return null;

  } catch (error) {
    console.error('获取或解析 m3u8 文件失败:', error);
    return null;
  }
}

// ==========================================
// 核心逻辑：播放器初始化与挂载
// ==========================================
async function init() {
  const video = document.getElementById('video');
  const ui = video['ui'];
  const controls = ui.getControls();
  const player = controls.getPlayer();

  // 暴露到全局 window 对象，方便你在 F12 控制台随时调试 (直接输入 player 即可查看)
  window.player = player;
  window.ui = ui;
  window.controls = controls;

  // 监听全局错误事件
  player.addEventListener("error", onPlayerErrorEvent);
  controls.addEventListener("error", onUIErrorEvent);

  let drmToken = '';

  // ==========================================
  // 1. 自动提取 kid 并动态请求 DRM Token
  // ==========================================
  const dynamicKid = await extractKidFromM3u8(manifestUri);

  if (dynamicKid) {
    try {
      console.log('正在使用提取到的 kid 请求 DRM Token...');
      const finalTokenUrl = baseTokenUrl + dynamicKid; 
      
      const response = await fetch(finalTokenUrl);
      const textData = await response.text(); 
      
      // 兼容 JSON 和纯文本返回格式
      try {
        const jsonData = JSON.parse(textData);
        drmToken = jsonData.token || jsonData.message || textData; 
      } catch (e) {
        drmToken = textData.trim(); 
      }
      console.log('✅ 动态 Token 获取成功！');
    } catch (error) {
      console.error('❌ Token 获取失败 (请检查网络或跨域拦截):', error);
    }
  } else {
    console.log('⚠️ 未获取到 kid，跳过 Token 请求。');
  }

  // ==========================================
  // 2. 配置 Widevine DRM 授权服务器
  // ==========================================
  player.configure({
    drm: {
      servers: {
        'com.widevine.alpha': licenseServerUrl
      }
    }
  });

  // ==========================================
  // 3. 网络请求拦截器：注入防盗链和 Token
  // ==========================================
  player.getNetworkingEngine().registerRequestFilter((type, request) => {
    
    // 【全局防盗链伪装】(注意：标准浏览器下 Origin 和 Referer 修改会被拦截，如报错请使用 Nginx 代理)
    request.headers['Origin'] = 'https://rtmklik.rtm.gov.my';
    request.headers['Referer'] = 'https://rtmklik.rtm.gov.my/';
    request.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

    // 【DRM 鉴权注入】
    if (type === shaka.net.NetworkingEngine.RequestType.LICENSE && drmToken) {
      request.headers['x-axdrm-message'] = drmToken;
    }
  });

  // ==========================================
  // 4. 加载并播放视频流
  // ==========================================
  try {
    console.log('正在加载视频源...');
    await player.load(manifestUri);
    console.log('🎉 频道加载并解密成功！');
  } catch (error) {
    onPlayerError(error);
  }

  // === 错误处理助手函数 ===
  function onPlayerErrorEvent(errorEvent) {
    onPlayerError(errorEvent.detail);
  }

  function onUIErrorEvent(errorEvent) {
    onPlayerError(errorEvent.detail);
  }

  function onPlayerError(error) {
    console.error('❌ 播放报错：错误码', error.code, '详情：', error);
  }
}

function initFailed(errorEvent) {
  console.error('❌ Shaka UI 库加载失败！请检查 HTML 中的网络连通性。');
}

// 启动入口：等待 UI 构建完毕后执行
document.addEventListener('shaka-ui-loaded', init);
document.addEventListener('shaka-ui-load-failed', initFailed);
