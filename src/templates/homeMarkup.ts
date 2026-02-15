export const renderHomeSection = () => `
  <section class="page home active" id="layout-empty">
    <div class="home-fx-layer" aria-hidden="true"></div>

    <div class="home-card">
      <header class="home-head">
        <div class="home-logo" aria-hidden="true">
          <img src="/android-chrome-192x192.png" alt="3D Printed Paper Craft logo" width="54" height="54" />
        </div>

        <div class="home-brand">
          <div class="home-title" data-i18n="app.title">3D 打印纸艺</div>
          <div class="home-subtitle" data-i18n="mainpage.tagline">低模一键生成可打印纸艺</div>
        </div>
      </header>

      <div class="home-body">
        <div class="home-meta" data-i18n="mainpage.localOnly">所有处理都在本地完成，不上传模型</div>

        <button class="home-btn home-btn--primary" id="home-start">
          <span class="home-btn-main" data-i18n="mainpage.guide">选择模型文件</span>
          <span class="home-btn-sub" data-i18n="mainpage.format.supported">OBJ / FBX / STL / 3DPPC</span>
        </button>

        <div class="home-alt">
          <div class="home-meta" data-i18n="mainpage.try.desc">还没有文件？</div>
          <button class="home-btn home-btn--secondary" id="home-demo" data-i18n="mainpage.try">
            试玩示例项目
          </button>
        </div>
      </div>

      <footer class="home-foot">
        <a class="home-link" href="https://github.com/kilomelo/3d_printed_paper_craft" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <span class="home-dot">·</span>
        <a
          class="home-link"
          data-i18n="mainpage.guideVideo.label"
          data-i18n-href="mainpage.guideVideo.href"
          href="https://www.bilibili.com/video/BV1CTJNzQEk4"
          target="_blank"
          rel="noreferrer"
        >
          使用指南视频
        </a>
        <span class="home-dot">·</span>
        <a class="home-link" href="https://github.com/kilomelo/3d_printed_paper_craft/blob/main/LICENSE" target="_blank" rel="noreferrer">
          GPL-3.0
        </a>
      </footer>
    </div>
  </section>
`;
