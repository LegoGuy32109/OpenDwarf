extends Node2D
class_name Dwarf

enum STATES {IDLE, MINING, MOVING}
var state : int = STATES.IDLE
var coordinates : Vector2i = Vector2i()

# might have gridSize set by the game manager
var gridSize : int = 64
# time taken off from transtion cost
var agentSpeed : float = 0.0

# needs to grab Tiles group for path finding
@onready var tiles : Node2D = self.get_parent().get_parent().find_child("Tiles")
# animated sprite child
#@onready var sprites : AnimatedSprite2D = $AnimatedSprite2D

@onready var pathfinder : Pathfinder = Pathfinder.new(tiles)

var commandQueue: CommandQueue = CommandQueue.new(self)

func _ready():
	$StateMenu.clear()
	var index : int = 0
	for key in STATES.keys():
		$StateMenu.add_item(key, index)
		index+=1


func _process(_delta):
	match state:
		STATES.IDLE:
			if not commandQueue.commandList.is_empty():
				await moveTo(commandQueue.nextCommand().desiredLocation)
				commandQueue.curCommandDone()
			elif randf() < 0.02:
				await _moveToNeighbor()



func _moveToNeighbor():
	var neighborTiles : Array[Tile] = pathfinder.findOpenNeighbors(coordinates)
	if (neighborTiles.size() > 0):
		var chosenTile : Tile = \
		neighborTiles[randi_range(0, neighborTiles.size()-1)]
		await moveTo(chosenTile.coordinates)

# handles visual movement to new location based on path from Pathfinder
func moveTo(newCoordinates : Vector2i) -> bool:
	state = STATES.MOVING
	while not newCoordinates == coordinates:
		var path : Array[Vector2i] = \
		pathfinder.findPathTo(newCoordinates, coordinates)
		
		# return false if tile not reachable
		if path.is_empty():
			state = STATES.IDLE
			print(name+" now can't find path to location")
			return false
		
		var tileCoords : Vector2i = path[1]
		var nextTile : Tile = tiles.get_child(tileCoords.x).get_child(tileCoords.y)
		var singleTween = create_tween()
		var curMoveCost : float = nextTile.movementCost - agentSpeed
		if pathfinder.isDiagNeighbor(coordinates, tileCoords):
			curMoveCost *= 1.2
		# tweening world position instead of tile coordinates
		singleTween.tween_property(self, "position", nextTile.position, curMoveCost)
		await singleTween.finished
		coordinates = tileCoords

#	print(self.name+" is now at "+str(coordinates))
	state = STATES.IDLE
	return true


# Turn grid coordinates -> world/Game coordinates * gridSize
func mapToWorld(coords: Vector2i) -> Vector2:
	return Vector2(coords.x * gridSize, coords.y * gridSize)

func _on_state_menu_item_selected(index):
	state = index
	print("Dwarf now ", STATES.keys()[state])
	
	
# this will grow more complex
class CommandQueue:
	var commandList : Array[Command] = []
	var currentCommand : Command = null
	var entity : Dwarf
	
	func _init(_entity: Dwarf):
		entity = _entity
	
	func order(command: Command):
		if not entity.state == STATES.MOVING:
			commandList.append(command)
		else:
			print(entity.name + " is already moving")
	
	func nextCommand() -> Command:
		var poppedCommand : Command = commandList.pop_front()
		currentCommand = poppedCommand
		return poppedCommand
	
	func curCommandDone()-> void:
		currentCommand = null
	
class Command:
	var desiredLocation: Vector2i
	func _init(newLoc:Vector2i):
		desiredLocation = newLoc
