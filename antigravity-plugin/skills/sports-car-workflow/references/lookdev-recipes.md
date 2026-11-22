# 跑车 PBR 材质与 AgX 棚拍参数表（Blender 4.5 LTS）

> Blender 4.5 LTS 中 `Principled BSDF` 使用 `Coat Weight` / `Coat Roughness` / `Coat IOR`、`Specular IOR Level`、`Transmission Weight`（已弃用 3.x 的 `Clearcoat` / `Specular` / `Transmission`）。修改自定义节点前请用 `blender_api_lookup(query="Principled BSDF")` 二次核验。

## 1. 跑车核心材质配方（对应 `blender_lookdev_preset`）

| 预设名 | 适用部位 | 关键参数（Blender 4.5 LTS） | 视觉要点 |
| :--- | :--- | :--- | :--- |
| `car_paint_clearcoat` | 车身覆盖件（引擎盖/翼子板/车门/车顶） | `Metallic: 0.82`, `Roughness: 0.22`, `Coat Weight: 1.0`, `Coat Roughness: 0.03`, `Coat IOR: 1.52`, Voronoi 微片 `Scale: 220` + Layer Weight 菲涅尔暗边 | 双层质感：底层金属微片随角度变暗，顶层清漆拉出锐利连续的高光带 |
| `automotive_glass` | 前/后风挡、侧窗、灯罩外玻璃 | `Base Color: (0.06,0.08,0.09)`, `Roughness: 0.02`, `IOR: 1.52`, `Transmission Weight: 0.92`, `Alpha: 0.35`, `Coat Weight: 0.6` | 深色隐私微 tint + 干净环境反射，保留座舱轮廓透视 |
| `brushed_alloy` | 轮毂、刹车盘、排气管尾喉、饰条 | `Metallic: 0.98`, `Anisotropic: 0.55`, 拉伸 Noise 控制 `Roughness (0.14–0.28)` | 方向性拉丝金属高光，避免廉价纯镜面 |
| `carbon_fiber` | 前唇、侧裙、扩散器、尾翼、后视镜壳 | `Metallic: 0.25`, `Roughness: 0.26`, `Coat Weight: 1.0`, `Coat Roughness: 0.04`, Checker/斜纹 Bump | 低明度深灰编织纹理 + 光面清漆罩层 |
| `tire_rubber` | 轮胎胎面与胎壁 | `Base Color: (0.022,0.022,0.024)`, `Metallic: 0.0`, `Roughness: 0.68`, `Specular IOR Level: 0.28`, 高频微颗粒 Bump | 吸光炭黑质感，绝不发灰或反塑料光 |

## 2. AgX 三点柔光棚拍规范（`studio_three_point_agx`）

- **色彩管理**：`view_transform = "AgX"`，`look = "AgX - Punchy"`（或 `"AgX - Medium High Contrast"`），`exposure = 0.15`。
- **布光结构**：
  - **主光（Key Softbox）**：宽矩形面光（`4.5m × 2.2m`），位于车身右前上方，拉出沿引擎盖与肩线延伸的连续高光带。
  - **补光（Fill Softbox）**：偏冷色大面光（`5.0m × 2.4m`），位于车身左前侧，托起暗部车身折线而不洗平对比度。
  - **顶逆光（Rim Overhead）**：长条柔光带（`6.0m × 1.4m`），位于车尾正上方，勾勒车顶溜背与后翼子板轮廓。
- **棚拍相机**：建议 `65mm–85mm` 中长焦（减少广角透视畸变），机位离地 `1.3m–1.65m` 呈前 3/4 低视角俯拍。
- **渲染引擎**：交互调试用 `BLENDER_EEVEE_NEXT`，最终成片通过 `blender_run(kind="render", engine="CYCLES")`（macOS Metal GPU）高采样输出。
