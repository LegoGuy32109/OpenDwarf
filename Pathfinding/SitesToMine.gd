# Keeps track of tiles that need to be mined, and what dwarves should mine what
extends Node

class_name SitesToMine

var max_dwarves_mining_tile : int = 5

class MineSite:
	var tile : Tile
	var dwarvesCurrentlyMining : Array[Dwarf] = []

var mineSites : Array[MineSite] = []

func is_empty()->bool:
	return mineSites.is_empty()

func siteExists(coords:Vector2i) -> MineSite:
	for site in mineSites:
		if site.tile.coordinates == coords:
			return site
	return null 

func addSite(tile:Tile)->void:
	if not siteExists(tile.coordinates):
		var site : MineSite = MineSite.new()
		tile.labelMineable()
		site.tile = tile
		mineSites.append(site)

func removeSite(tile:Tile):
	var siteToRemove = siteExists(tile.coordinates)
	if siteToRemove:
		tile.removeMineable()
		mineSites.erase(siteToRemove)

# find closest site to mine for entity, don't allow more than one dwarf to mine a block  
# unless no other sites to mine are reachable
func assignSite(entity: Dwarf, pf: Pathfinder)->bool:
	var siteToMine : MineSite = null
	var pathToTile : Array[Vector2i] 
	var otherMinerMax : int = 0
	
	while otherMinerMax <= max_dwarves_mining_tile:
		for site in mineSites:
			# null or Array[Vector2i]
			var potentialPath = pf.findClosestNeighborPath(\
			site.tile.coordinates, entity.coordinates)
			
			if potentialPath:
				var path : Array[Vector2i] = potentialPath
				# if there is a path, and there aren't too many dwarves mining it,
				# and we actually have a site defined, and it's the closest one
				if not path.is_empty() \
				and site.dwarvesCurrentlyMining.size() < otherMinerMax \
				and (not siteToMine or pathToTile.size() > path.size()):
					pathToTile = path
					siteToMine = site
				
		otherMinerMax += 1 # look for a tile with another dwarf, or more dwarves
	
	if siteToMine:
		print("I will mine "+str(siteToMine.tile.coordinates))
		siteToMine.dwarvesCurrentlyMining.append(entity)
		
		var coordsToMoveTo = pathToTile[-1]
		entity.commandQueue.order(Dwarf.Move.new(coordsToMoveTo))
		entity.commandQueue.order(Dwarf.Mine.new([siteToMine.tile.coordinates]))
		
		entity.iAmMiningStuff = true
		return true
	else:
		print("literally nothing I can do")
		return false
