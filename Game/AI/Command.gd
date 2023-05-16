extends Node

class_name Command

func getType()->String:
	return "command"

# abstract method to remove warnings
func run(_entity: Dwarf)->Signal:
	return get_tree().create_timer(1).timeout


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


class Mine extends Command:
	var site : SitesToMine.MineSite
	
	func _init(_site : SitesToMine.MineSite):
		site = _site

	func getType()->String:
		return "mine"
