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
func nextSite(entityCoords: Vector2i):
	var validSites : Array[MineSite] = []
	for site in mineSites:
		if pathfinder.findClosestNeighborPath(site.tile.coordinates, entityCoords):
			validSites.append(site)
			
	if validSites.is_empty():
		return null
	
	var siteToMine : MineSite 
	var shortestPath : Array[Vector2i] = []
	var otherMinerMax = 0
	
	while otherMinerMax <= max_dwarves_mining_tile:
	
		for site in validSites:
			var pathToSite : Array[Vector2i] = \
			pathfinder.findClosestNeighborPath(site.tile.coordinates, entityCoords)
			
			if site.dwarvesCurrentlyMining.size() < otherMinerMax and \
			(not siteToMine or pathToSite.size() < shortestPath.size()):
				shortestPath = pathToSite
				siteToMine = site
		
		otherMinerMax += 1
	
	if not siteToMine:
		return null

	return {"location": shortestPath[-1], "site": siteToMine}
