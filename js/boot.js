// 드론 정비 시뮬레이터 — 3D 엔진(three.js r170, 모듈) 불러오기 → 기존 스크립트를 순서대로 실행
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";

window.THREE = Object.assign({}, THREE, { addons: { EffectComposer, RenderPass, GTAOPass, UnrealBloomPass, OutputPass, EXRLoader } });
for (const src of ["js/config.js", "js/core.js", "js/scene.js", "js/flight.js", "js/ui.js", "js/session.js", "js/main.js"]) {
  const s = document.createElement("script"); s.src = src; s.async = false; document.body.appendChild(s);
}
