extends Node

class_name Command

func getType()->String:
	return "command"

# abstract method to remove warnings
func run(_entity: Dwarf)->Signal:
	return get_tree().create_timer(1).timeout

# used to confirm ordering this command is valid for the entity, usually true
func valid(_entity: Dwarf)->bool:
	return true

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
		
		# path exists, prepare to move towards a spot next to mine site
		if path:
			targetCoordinates = path[-1]
			entity.currentAction = Dwarf.Actions.MOVING
			# moving to the site
			if await entity.moveTo(self):
				print("I'm mining a tile")
				entity.currentAction = Dwarf.Actions.MINING
				await entity.startMining(site)
			else:
				print("My move to a mine site failed")
		else:
			print("I can't think of a way to get to this mine site")
		
		entity.commandQueue.nextCommand()
	
	func valid(entity: Dwarf):
		for c in entity.commandQueue.commandList:
			if c.getType() == "mine":
				if c.site.coordinates == site.coordinates:
					return false
		return true

	func getType()->String:
		return "mine"
