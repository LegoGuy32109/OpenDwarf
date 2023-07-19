# Keeps track of tiles that need to be mined, and what dwarves should mine what
extends Node

class_name SitesToMine

var max_dwarves_mining_tile : int = 2
var pathfinder : Pathfinder

class MineSite:
	var tile : Tile
	var dwarvesCurrentlyMining : Array[Dwarf] = []

var mineSites : Array[MineSite] = []

func _init(pf : Pathfinder):
	pathfinder = pf
	
func is_empty()->bool:
	return mineSites.is_empty()

func siteExists(coords:Vector2i) -> MineSite:
	for site in mineSites:
		if site.tile.coordinates == coords:
			return site
	return null 

func addSite(tile:Tile)->void:
	if not tile.orderedToMine:
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
func nextSite(entity: Dwarf):
	# [{site: MineSite, path: Array[Vector2i]}, ...]
	var validSites : Array = []
	for site in mineSites:
		if site.tile.traversable:
			mineSites.erase(site)
		else:
			var path = pathfinder.findClosestNeighborPath(site.tile.coordinates, entity.coordinates)
			if path:
				validSites.append({"site": site, "path": path})
			
	if validSites.is_empty():
		return false
	
	var siteToMine : MineSite 
	var shortestPath : Array[Vector2i] = []
	var otherMinerMax = 0
	
	while otherMinerMax <= max_dwarves_mining_tile:
	
		for siteObj in validSites:
			if siteObj.path is Array[Vector2i] and siteObj.site.dwarvesCurrentlyMining.size() < otherMinerMax and \
			(not siteToMine or siteObj.path.size() < shortestPath.size()):
				shortestPath = siteObj.path
				siteToMine = siteObj.site
		
		otherMinerMax += 1
	
	if not siteToMine:
		return false

	entity.commandQueue.order(Command.Mine.new(siteToMine.tile))
	return true