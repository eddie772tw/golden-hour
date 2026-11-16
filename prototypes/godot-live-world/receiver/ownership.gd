extends RefCounted
class_name GHWorldOwnership
# Metadata-only classification. No static object is removed by a name heuristic.
static func actor_key(actor: int,rig: int) -> String: return "%d/%d"%[actor,rig]

static func replacement_actors(hello: Dictionary) -> Dictionary:
	var map: Dictionary={}
	for skin in hello.get("skins",[]):
		if bool(skin.firstPerson): continue # The first-person subset remains unported.
		map[actor_key(int(skin.actor),int(skin.rigIndex))]=int(skin.id)
	return map

static func classify(item: Dictionary,actors: Dictionary) -> Dictionary:
	var actor_owners: Dictionary={}
	var physics: Array=[]
	var k9: Array=[]
	for owner in item.get("owners",[]):
		if owner.get("kind","")=="actor": actor_owners[actor_key(int(owner.actor),int(owner.rig))]=owner
		elif owner.get("kind","")=="physics": physics.append(owner)
		elif owner.get("kind","")=="k9": k9.append(owner)
	if not actor_owners.is_empty():
		if actor_owners.size()!=1: return {"kind":"excluded-unmapped-dynamic","reason":"ambiguous actor ownership","owners":item.owners}
		var key: String=str(actor_owners.keys()[0])
		if item.get("skin") is Dictionary and actors.has(key):
			return {"kind":"replaced-live-skin","liveSkinID":actors[key],"proof":actor_owners[key]}
		return {"kind":"excluded-unmapped-dynamic","reason":"actor attachment/FPbody lacks accepted live output mapping","proof":actor_owners[key]}
	if not physics.is_empty():
		if physics.size()!=1: return {"kind":"excluded-unmapped-dynamic","reason":"ambiguous physics ownership","owners":item.owners}
		var owner: Dictionary=physics[0]
		if int(owner.get("propIndex",-1))>=0 and str(owner.get("type",""))=="box" and not bool(owner.get("temp",false)):
			return {"kind":"candidate-initial-prop","owner":owner,"sourcePropIndex":int(owner.propIndex)}
		return {"kind":"excluded-unmapped-dynamic","reason":"temporary/noninitial original physics body needs true asset","proof":owner}
	if not k9.is_empty(): return {"kind":"excluded-unmapped-dynamic","reason":"K9 custom part deformation unported","proof":k9}
	if item.get("skin") is Dictionary:
		return {"kind":"excluded-unmapped-dynamic","reason":"unowned frozen skin is not a proven static world object"}
	return {"kind":"static-or-unowned-source","reason":"Preserve original capture; no owner evidence authorizes removal"}

static func capture_root_path(item: Dictionary,owner: Dictionary) -> String:
	var relative: String=str(owner.get("path",""))
	var path: String=str(item.get("path",""))
	if relative.is_empty(): return path
	if not path.ends_with(relative): return ""
	return path.substr(0,path.length()-relative.length())

static func matches_prop_child(item: Dictionary,g: Dictionary,owner: Dictionary,prop: Dictionary,child: Dictionary,canonical: Dictionary) -> Dictionary:
	if str(owner.get("path",""))!=str(child.path): return {"ok":false,"reason":"original child traversal path differs"}
	var root_path: String=capture_root_path(item,owner)
	if root_path.is_empty() or not root_path.ends_with(":"+str(prop.name)):
		return {"ok":false,"reason":"source owner root path/name differs"}
	if g.get("frozenPose",false) or item.get("skin") is Dictionary:
		return {"ok":false,"reason":"posed geometry cannot be an original prop rest match"}
	if int(g.position.count)!=int(canonical.vertexCount): return {"ok":false,"reason":"vertex count differs"}
	return {"ok":true,"reason":"owner index/path/root name plus canonical original geometry hashes must also match at caller","captureRootPath":root_path}
