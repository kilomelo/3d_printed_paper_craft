// Settings panel and rename dialog HTML templates
import { SETTINGS_LIMITS } from "../modules/settings";

const limits = SETTINGS_LIMITS;

export const renderSettingsOverlay = () => `
  <div id="settings-overlay" class="settings-overlay hidden">
    <div class="settings-modal">
      <div class="settings-header">
        <div class="settings-title" data-i18n="settings.title">项目设置</div>
      </div>
        <div class="settings-body">
          <div class="settings-nav">
          <button class="settings-nav-item active" id="settings-nav-basic" data-i18n="settings.nav.basic">基础设置</button>
          <button class="settings-nav-item" id="settings-nav-interlocking" data-i18n="settings.nav.interlocking">咬合拼接</button>
          <button class="settings-nav-item" id="settings-nav-clip" data-i18n="settings.nav.clip">卡扣拼接</button>
          <button class="settings-nav-item" id="settings-nav-experiment" data-i18n="settings.nav.experimental">实验设置</button>
        </div>
        <div class="settings-content">
          <div class="settings-panel active" id="settings-panel-basic">
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-scale" class="setting-label" data-i18n="settings.scale.label">缩放比例</label>
                <span class="setting-desc" data-i18n="settings.scale.desc">模型整体缩放比例，太小会导致打印文件生成失败</span>
              </div>
              <div class="setting-field">
                <input id="setting-scale" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-scale-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-layer-height" class="setting-label" data-i18n="settings.layerHeight.label">打印层高</label>
                <span class="setting-desc" data-i18n="settings.layerHeight.desc">实际打印时的层高设置，最大${limits.layerHeight.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-layer-height" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-layer-height-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.connectionLayers.label">连接层数</span>
                <span class="setting-desc" data-i18n="settings.connectionLayers.desc">面之间连接处的层数，${limits.connectionLayers.min}-${limits.connectionLayers.max}</span>
              </div>
              <div class="setting-field">
                <div class="setting-counter-group">
                  <button id="setting-connection-layers-dec" class="btn settings-inline-btn">-</button>
                  <span id="setting-connection-layers-value" class="setting-range-value"></span>
                  <button id="setting-connection-layers-inc" class="btn settings-inline-btn">+</button>
                </div>
                <button id="setting-connection-layers-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.bodyLayers.label">主体额外层数</span>
                <span class="setting-desc" data-i18n="settings.bodyLayers.desc">面主体的额外层数，${limits.bodyLayers.min}-${limits.bodyLayers.max}</span>
              </div>
              <div class="setting-field">
                <div class="setting-counter-group">
                  <button id="setting-body-layers-dec" class="btn settings-inline-btn">-</button>
                  <span id="setting-body-layers-value" class="setting-range-value"></span>
                  <button id="setting-body-layers-inc" class="btn settings-inline-btn">+</button>
                </div>
                <button id="setting-body-layers-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.joinType.label">拼接方式</span>
                <span class="setting-desc" data-i18n="settings.joinType.desc">拼接边的默认连接方式</span>
              </div>
              <div class="setting-field">
                <div class="settings-toggle-group">
                  <button id="setting-join-type-interlocking" class="btn settings-inline-btn" data-i18n="settings.joinType.interlocking">咬合</button>
                  <button id="setting-join-type-clip" class="btn settings-inline-btn" data-i18n="settings.joinType.clip">卡扣</button>
                </div>
                <button id="setting-join-type-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-min-fold-angle-threshold" class="setting-label" data-i18n="settings.minFoldAngleThreshold.label">折痕最小角度阈值</label>
                <span class="setting-desc" data-i18n="settings.minFoldAngleThreshold.desc">角度小于该数值的三角面之间不会生成折痕</span>
              </div>
              <div class="setting-field">
                <input id="setting-min-fold-angle-threshold" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-min-fold-angle-threshold-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
          </div>
          <div class="settings-panel" id="settings-panel-interlocking">
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-claw-interlocking-angle" class="setting-label" data-i18n="settings.clawInterlockingAngle.label">咬合角度</label>
                <span class="setting-desc" data-i18n="settings.clawInterlockingAngle.desc">抱爪的互锁角度，最小${limits.clawInterlockingAngle.min}，最大${limits.clawInterlockingAngle.max}</span>
              </div>
              <div class="setting-field">
                <input id="setting-claw-interlocking-angle" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-claw-interlocking-angle-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-claw-target-radius" class="setting-label" data-i18n="settings.clawTargetRadius.label">目标抱爪半径</label>
                <span class="setting-desc" data-i18n="settings.clawTargetRadius.desc">抱爪的期望大小，最小${limits.clawTargetRadius.min}，最大${limits.clawTargetRadius.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-claw-target-radius" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-claw-target-radius-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.clawRadiusAdaptive.label">抱爪半径自适应</span>
                <span class="setting-desc" data-i18n="settings.clawRadiusAdaptive.desc">根据拼接夹角调整抱爪半径，改善拼接牢固度</span>
              </div>
              <div class="setting-field">
                <div class="settings-toggle-group">
                  <button id="setting-claw-radius-adaptive-off" class="btn settings-inline-btn" data-i18n="settings.clawRadiusAdaptive.off">关闭</button>
                  <button id="setting-claw-radius-adaptive-on" class="btn settings-inline-btn" data-i18n="settings.clawRadiusAdaptive.on">开启</button>
                </div>
                <button id="setting-claw-radius-adaptive-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-claw-width" class="setting-label" data-i18n="settings.clawWidth.label">抱爪宽度</label>
                <span class="setting-desc" data-i18n="settings.clawWidth.desc">单个抱爪的宽度，最小${limits.clawWidth.min}，最大${limits.clawWidth.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-claw-width" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-claw-width-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-claw-fit-gap" class="setting-label" data-i18n="settings.clawFitGap.label">抱爪配合间隙</label>
                <span class="setting-desc" data-i18n="settings.clawFitGap.desc">抱爪的松紧程度，越大越容易安装，${limits.clawFitGap.min}-${limits.clawFitGap.max}</span>
              </div>
              <div class="setting-field">
                <input id="setting-claw-fit-gap" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-claw-fit-gap-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
          </div>
          <div class="settings-panel" id="settings-panel-clip">
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-tab-width" class="setting-label" data-i18n="settings.tabWidth.label">拼接边舌片宽度</label>
                <span class="setting-desc" data-i18n="settings.tabWidth.desc">用于拼接边粘接的舌片宽度，${limits.tabWidth.min}-${limits.tabWidth.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-tab-width" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-tab-width-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-tab-thickness" class="setting-label" data-i18n="settings.tabThickness.label">拼接边舌片厚度</label>
                <span class="setting-desc" data-i18n="settings.tabThickness.desc">用于拼接边粘接的舌片厚度，${limits.tabThickness.min}-${limits.tabThickness.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-tab-thickness" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-tab-thickness-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <label for="setting-tab-clip-gap" class="setting-label" data-i18n="settings.tabClipGap.label">夹子配合间隙</label>
                <span class="setting-desc" data-i18n="settings.tabClipGap.desc">连接舌片的夹子松紧程度，值越大越容易安装，${limits.tabClipGap.min}-${limits.tabClipGap.max}</span>
              </div>
              <div class="setting-field">
                <input id="setting-tab-clip-gap" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-tab-clip-gap-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.clipGapAdjusts.label">夹子厚度</span>
                <span class="setting-desc" data-i18n="settings.clipGapAdjusts.desc">夹子模型的配合间隙自动根据舌片厚度反比补偿</span>
              </div>
              <div class="setting-field">
                <div class="settings-toggle-group">
                  <button id="setting-clip-thickness-normal" class="btn settings-inline-btn" data-i18n="settings.clipGapAdjusts.off">标准</button>
                  <button id="setting-clip-thickness-narrow" class="btn settings-inline-btn" data-i18n="settings.clipGapAdjusts.on">薄夹</button>
                </div>
                <button id="setting-clip-thickness-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
          </div>
          <div class="settings-panel" id="settings-panel-experiment">
            <div class="setting-row">
              <div class="setting-label-row">
                <span class="setting-label" data-i18n="settings.hollow.label">镂空风格</span>
                <span class="setting-desc" data-i18n="settings.hollow.desc">去除三角面的中间部分</span>
              </div>
              <div class="setting-field">
                <div class="settings-toggle-group">
                  <button id="setting-hollow-off" class="btn settings-inline-btn" data-i18n="settings.hollow.off">关闭</button>
                  <button id="setting-hollow-on" class="btn settings-inline-btn" data-i18n="settings.hollow.on">开启</button>
                </div>
                <button id="setting-hollow-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
            <div class="setting-row" id="setting-wireframe-row">
              <div class="setting-label-row">
                <label for="setting-wireframe-thickness" class="setting-label" data-i18n="settings.wireframeThickness.label">线框粗细</label>
                <span class="setting-desc" data-i18n="settings.wireframeThickness.desc">镂空风格下线框的粗细，${limits.wireframeThickness.min}-${limits.wireframeThickness.max}，单位mm</span>
              </div>
              <div class="setting-field">
                <input id="setting-wireframe-thickness" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" />
                <button id="setting-wireframe-thickness-reset" class="btn settings-inline-btn" data-i18n="settings.resetDefault.btn">恢复默认</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-footer">
        <button id="settings-cancel-btn" class="btn ghost settings-action" data-i18n="settings.cancel.btn">取消</button>
        <button id="settings-confirm-btn" class="btn primary settings-action" data-i18n="settings.confirm.btn">确定</button>
      </div>
    </div>
  </div>
`;

export const renderRenameDialog = () => `
  <div id="rename-overlay" class="rename-overlay hidden">
    <div id="rename-modal" class="rename-modal">
      <div class="settings-header">
        <div class="settings-title" data-i18n="rename.title">修改展开组名称</div>
      </div>
      <div class="settings-body rename-body">
        <input id="rename-input" type="text" autocomplete="off" data-i18n-placeholder="rename.placeholder" />
      </div>
      <div class="settings-footer">
        <button id="rename-cancel-btn" class="btn ghost settings-action" data-i18n="settings.cancel.btn">取消</button>
        <button id="rename-confirm-btn" class="btn primary settings-action" data-i18n="settings.confirm.btn">确定</button>
      </div>
    </div>
  </div>
`;

export const renderExportDialog = () => `
  <div id="export-overlay" class="settings-overlay hidden">
    <div class="settings-modal export-modal">
      <div class="settings-header">
        <div class="settings-title" data-i18n="export.title">导出展开组</div>
      </div>
      <div class="settings-body export-body">
        <div class="export-content">
          <div class="export-section export-meta-section">
            <div class="export-row export-meta-row">
              <span class="export-row-title" data-i18n="export.groupName">展开组名称</span>
              <span id="export-group-name" class="export-row-info export-truncate"></span>
            </div>
            <div class="export-row export-meta-row">
              <span class="export-row-title" data-i18n="export.faceCount">展开组面数</span>
              <span id="export-face-count" class="export-row-info export-row-info-strong"></span>
            </div>
          </div>

          <div class="export-section export-options-section">
            <div id="export-stl-option" class="export-option-card is-selected">
              <label for="export-stl-checkbox" class="export-option-header">
                <input type="checkbox" id="export-stl-checkbox" class="export-row-checkbox export-checkbox-input" checked />
                <span class="export-checkbox-visual" aria-hidden="true"></span>
                <span class="export-option-label" data-i18n="export.exportStl">导出 STL</span>
              </label>
              <div class="export-row export-file-row">
                <span class="export-row-title" data-i18n="export.stlFileName">STL 文件名</span>
                <span id="export-stl-filename" class="export-row-info export-truncate"></span>
              </div>
            </div>

            <div id="export-step-option" class="export-option-card">
              <label for="export-step-checkbox" class="export-option-header">
                <input type="checkbox" id="export-step-checkbox" class="export-row-checkbox export-checkbox-input" />
                <span class="export-checkbox-visual" aria-hidden="true"></span>
                <span class="export-option-label" data-i18n="export.exportStep">导出 STEP</span>
              </label>
              <div class="export-row export-file-row">
                <span class="export-row-title" data-i18n="export.stepFileName">STEP 文件名</span>
                <span id="export-step-filename" class="export-row-info export-truncate"></span>
              </div>
            </div>

            <div id="export-png-option" class="export-option-card">
              <label for="export-png-checkbox" class="export-option-header">
                <input type="checkbox" id="export-png-checkbox" class="export-row-checkbox export-checkbox-input" />
                <span class="export-checkbox-visual" aria-hidden="true"></span>
                <span class="export-option-label" data-i18n="export.exportPng">导出 PNG</span>
              </label>
              <div class="export-row export-file-row">
                <span class="export-row-title" data-i18n="export.pngFileName">PNG 文件名</span>
                <span id="export-png-filename" class="export-row-info export-truncate"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-footer">
        <button id="export-cancel-btn" class="btn ghost settings-action" data-i18n="settings.cancel.btn">取消</button>
        <button id="export-confirm-btn" class="btn primary settings-action" data-i18n="export.confirm.btn">导出</button>
      </div>
    </div>
  </div>
`;

export const renderLuminaLayersDialog = () => `
  <div id="lumina-layers-overlay" class="settings-overlay hidden">
    <div class="settings-modal lumina-layers-modal">
      <div class="settings-header">
        <div class="settings-title" data-i18n="luminaLayers.title">叠色打印工具</div>
      </div>
      <div class="settings-body lumina-layers-body">
        <div class="lumina-layers-content">
          <section class="lumina-hero-card">
            <div class="lumina-hero-copy">
            <div class="lumina-hero-desc" data-i18n="luminaLayers.purpose">该工具用于创建可直接载入切片软件的叠色3mf文件</div>
            <a
              class="lumina-link-pill"
              href="https://github.com/MOVIBALE/Lumina-Layers"
              target="_blank"
              rel="noopener noreferrer"
              title="https://github.com/MOVIBALE/Lumina-Layers"
            >
              <span class="lumina-link-main">https://github.com/MOVIBALE/Lumina-Layers</span>
              <span class="lumina-link-cta" aria-hidden="true">↗</span>
            </a>
            </div>
          </section>

          <section class="lumina-info-grid">
            <article class="lumina-info-card lumina-steps-card">
              <div class="lumina-card-head">
                <div class="lumina-card-title" data-i18n="luminaLayers.usage">简要使用说明</div>
              </div>
              <ol class="lumina-step-list">
                <li class="lumina-step-item">
                  <span class="lumina-step-index">1</span>
                  <span class="lumina-step-text" data-i18n="luminaLayers.step1">步骤一：点击下方[导出图片]按钮导出当前展开组的贴图</span>
                </li>
                <li class="lumina-step-item">
                  <span class="lumina-step-index">2</span>
                  <span class="lumina-step-text" data-i18n="luminaLayers.step2">步骤二：将导出的图片导入Lumina-Layers，输出叠色打印3mf文件</span>
                </li>
                <li class="lumina-step-item">
                  <span class="lumina-step-index">3</span>
                  <span class="lumina-step-text" data-i18n="luminaLayers.step3">步骤三：将Lumina-Layers输出的3mf文件拖入下方的文件拖拽区域，即可生成可拼接的叠色展开组3mf文件至下载目录</span>
                </li>
              </ol>
            </article>

            <article class="lumina-info-card lumina-link-card">
              <div class="lumina-card-head">
                <div class="lumina-card-title" data-i18n="luminaLayers.videoLink">详细使用方法请参考该视频：</div>
                <div class="lumina-card-subtitle">Bilibili</div>
              </div>
              <div class="video">
                <iframe
                  id="lumina-layers-video-iframe"
                  data-src="//player.bilibili.com/player.html?isOutside=true&aid=116085248493480&bvid=BV1cAZkBeEZ6&cid=36120365789&p=1&t=0&autoplay=0"
                  src=""
                  scrolling="no"
                  border="0"
                  frameborder="no"
                  framespacing="0"
                  allowfullscreen="true">
                </iframe>
              </div>
              <!-- 即将发布 -->
            </article>
          </section>

          <section class="lumina-meta-card">
            <div class="lumina-meta-row">
              <span class="lumina-meta-title" data-i18n="export.groupName">展开组名称</span>
              <span id="lumina-layers-group-name" class="lumina-meta-info lumina-truncate"></span>
            </div>
            <div class="lumina-meta-row">
              <span class="lumina-meta-title" data-i18n="export.faceCount">展开组面数</span>
              <span id="lumina-layers-face-count" class="lumina-meta-info lumina-meta-info-strong"></span>
            </div>
          </section>

          <section class="lumina-action-grid">
            <article class="lumina-action-card">
              <div class="lumina-card-head">
                <div class="lumina-card-title" data-i18n="luminaLayers.exportTexture.title">导出展开组贴图</div>
              </div>
              <span id="lumina-layers-png-filename" class="lumina-action-filename lumina-truncate"></span>
              <button id="lumina-layers-export-png-btn" class="btn primary lumina-action-btn">
                <span class="lumina-action-btn-label" data-i18n="luminaLayers.exportTexture.btn">导出展开组贴图</span>
              </button>
            </article>

            <article class="lumina-action-card lumina-drop-card">
              <div class="lumina-card-head">
                <div class="lumina-card-title">处理 Lumina-Layers 输出的 3mf 文件</div>
              </div>
              <div id="lumina-layers-drop-zone" class="lumina-drop-zone" role="button" tabindex="0">
                <div class="lumina-drop-icon" aria-hidden="true">+</div>
                <div class="lumina-drop-copy">
                  <div class="lumina-drop-title" data-i18n="luminaLayers.dropZone">接受文件拖拽（.3mf）</div>
                  <div class="lumina-drop-hint">拖入 Lumina-Layers 输出的 3MF 文件</div>
                </div>
              </div>
            </article>
          </section>
        </div>
      </div>
      <div class="settings-footer">
        <button id="lumina-layers-close-btn" class="btn ghost settings-action" data-i18n="luminaLayers.close.btn">关闭</button>
      </div>
    </div>
  </div>
`;
