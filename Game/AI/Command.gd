extends Node

class_name Command

func getType()->String:
	return "command"

func run(entity: Dwarf)->bool:
	return true

class Move extends Command:
	var desiredLocation: Vector2i
	
	func _init(coordinates: Vector2i):
		desiredLocation = coordinates
		
	func changeLocation(coordinates: Vector2i):
		desiredLocation = coordinates
		
	func run(entity: Dwarf):
		entity.currentAction = Dwarf.Actions.MOVING
		# pass instance of self instead of raw coordinates, Move desiredLocation can change
		if await entity.moveTo(self):
			entity.commandQueue.nextCommand()
		else:
			print("My move failed")
			entity.commandQueue.nextCommand()
			
	func getType()->String:
		return "move"


class MoveAdjacent extends Command:
	var nontraversableTile: Tile
	var traversableNeighbor: Tile
	
	func _init(rockTile: Tile, neighborTile: Tile = null):
		nontraversableTile = rockTile
		traversableNeighbor = neighborTile
		
#	func run(entity : Dwarf):	
#		var path : Array[Vector2i] = entity.pathfinder.findClosestNeighborPath(
#			nontraversableTile.coordinates, entity.coordinates
#		)
#
#		if await entity.moveTo(path[-1]):
#			entity.commandQueue.nextCommand()
#		else:
#			print("I couldn't get next to this tile")
#			entity.commandQueue.nextCommand()
	
	func getType()->String:
		return "moveAdjacent"


class Mine extends Command:
	var site : SitesToMine.MineSite
	
	func _init(_site : SitesToMine.MineSite):
		site = _site

	func getType()->String:
		return "mine"
