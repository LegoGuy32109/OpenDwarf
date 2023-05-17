extends Node

class_name Command

func getType()->String:
	return "command"

# abstract method to remove warnings
func run(_entity: Dwarf)->Signal:
	return get_tree().create_timer(1).timeout


class Move extends Command:
	var targetCoordinates: Vector2i
	
	func _init(coordinates: Vector2i):
		targetCoordinates = coordinates
		
	func changeLocation(coordinates: Vector2i):
		targetCoordinates = coordinates
		
	func run(entity: Dwarf):
		entity.currentAction = Dwarf.Actions.MOVING
		# pass instance of self instead of raw coordinates, Move targetCoordinates can change
		if await entity.moveTo(self):
			pass 
		else:
			print("My move failed")
			
		entity.commandQueue.nextCommand()
			
	func getType()->String:
		return "move"


class Mine extends Command:
	var site : Tile
	var targetCoordinates : Vector2i
	
	func _init(tile: Tile):
		site = tile
	
	func run(entity: Dwarf):
		# find a path to a nearby tile
		var path = entity.pathfinder.findClosestNeighborPath(site.coordinates, entity.coordinates)
		print(path)
		targetCoordinates = path[-1]
		
		entity.currentAction = Dwarf.Actions.MOVING
		if path and await entity.moveTo(self):
			print("I'm mining a tile")
			entity.currentAction = Dwarf.Actions.MINING
			await entity.startMining(site)
			entity.tileThoughts.erase(site.coordinates)
		else:
			print("My move to a mine site failed")
		
		entity.commandQueue.nextCommand()
	
	func getType()->String:
		return "mine"
