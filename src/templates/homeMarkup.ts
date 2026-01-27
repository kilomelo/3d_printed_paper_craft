export const renderHomeSection = () => `
    <section class="page home active" id="layout-empty">
      <div class="home-card">
        <div class="home-title" data-i18n="app.title">3D打印纸艺</div>
        <div class="home-meta" data-i18n="mainpage.format.supported">支持格式 OBJ / FBX / STL / 3DPPC</div>
        <button class="home-btn" id="home-start" data-i18n="mainpage.guide">选择模型文件</button>
        <div class="home-meta" data-i18n="mainpage.try.desc">还没有文件？</div>
        <button class="home-btn" id="home-demo" data-i18n="mainpage.try">试玩示例项目</button>
      </div>
    </section>
`;
