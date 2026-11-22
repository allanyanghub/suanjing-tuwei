# 武器美术源文件

- `blib.py`：Blender 5.x 建模 / 烘焙 / 导出工具库；`yuyan.py` `jingzhe.py` `changgeng.py` `arms.py` 为原创模型的建模脚本，`qiming.py` `tianshu.py` 为 Poly Haven 模型的规范化脚本。
- 在 Blender 中执行：先把 `blib.py` 里的 `SCR` 改成本机临时目录（需含 Poly Haven 下载与 `ph_re/` 重编码贴图），然后 `FINISH=True; exec(open('<脚本>').read())`，会新建独立场景、烘焙贴图并导出到 `public/assets/weapons/<id>.glb`。
- `*.blend`：各枪最终场景（几何体 + 烘焙后材质；贴图外链于临时目录，重建请运行脚本）。
