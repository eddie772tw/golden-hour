import { bind } from "../i18n/dom.js";
import { models, factoryNames, selectModel, selectedModel } from "./weapon-models.js";

export function installModelSelector(menus) {
  const page=menus.pages.gunsmith;
  const panel=document.createElement("section");
  panel.className="weapon-model-panel";
  const label=document.createElement("label");
  const caption=document.createElement("span"), select=document.createElement("select");
  const summary=document.createElement("p"), stats=document.createElement("p");
  select.id="weapon-model";
  bind(caption,"weapon.model");
  label.append(caption,select);
  panel.append(label,summary,stats);
  page.querySelector(".gs-left").prepend(panel);
  select.addEventListener("change",()=>{
    selectModel(menus.gs.w,select.value);
    menus._gsRender(false);
  });
  const render=menus._gsRender;
  menus._gsRender=function(...args) {
    const result=render.apply(this,args);
    const family=this.gs.w, id=selectedModel(family);
    if (select.dataset.family!==family) {
      select.dataset.family=family;
      select.replaceChildren(new Option(factoryNames[family],family));
      for (const [key,model] of Object.entries(models)) {
        if (model.family===family) select.add(new Option(model.name,key));
      }
    }
    select.value=id;
    panel.hidden=select.options.length<2;
    const variant=models[id];
    summary.hidden=stats.hidden=!variant;
    page.querySelector("#gs-wdesc").hidden=!!variant;
    if (variant) {
      bind(summary,"weapon."+id);
      bind(stats,"weapon.model_stats",variant.mag,Math.round(variant.rpm),variant.pellets,variant.dmg[0]);
    }
    for (const tab of page.querySelectorAll("#gs-tabs [data-w]")) {
      const current=selectedModel(tab.dataset.w);
      tab.querySelector("span").textContent=models[current]?.name ?? factoryNames[current];
    }
    return result;
  };
}
