/* Optional Toy SDK test double. No SDK downloads, tokens or production services. */
export function fixture(search=location.search, storage=localStorage) {
  const q=new URLSearchParams(search), user=q.get("toy");
  if (!user) return null;
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(user)) return null;
  const mode=q.get("fixture"), nickname="DEV "+user;
  const key="gh_dev_cloud:"+user;
  const read=k=>JSON.parse(storage.getItem(k)||"{}");
  return {
    isSupport:async method=>method==="setCloudStorage" && mode!=="readonly",
    async getUserProfile() { if (mode==="denied") throw {type:"user_denied"}; return {toyOpenId:"dev:"+user,nickname}; },
    getCloudStorage:async()=>read(key),
    async setCloudStorage(writes) { if (mode==="readonly" || mode==="write-error") throw Error("fixture write failed");
      storage.setItem(key,JSON.stringify({...read(key),...writes})); },
  };
}
