extends Node2D
class_name Dwarf

enum STATES {IDLE, MINING, MOVING}
var state : int = STATES.IDLE
var coordinates : Vector2i = Vector2i()

# might have gridSize set by the game manager
var gridSize : int = 64
# 1.0 default, multipies time taken to move over tiles
var agentSpeed : float = 1.0

# Communicate with world node
@onready var world : Node2D = self.get_parent().get_parent()
# needs to grab Tiles group for path finding
@onready var tiles : TileParent = world.find_child("Tiles")
# animated sprite child
@onready var sprites : AnimatedSprite2D = $AnimatedSprite2D

@onready var pathfinder : Pathfinder = world.pathfinder

var commandQueue: CommandQueue = CommandQueue.new(self)

var tooltipText: String = ""

func _ready():
	agentSpeed = RandomNumberGenerator.new().randi_range(85, 120)/100.0
	tooltipText = name+"\nSpeed: "+str(agentSpeed)


func _process(_delta):
	if HUD.tileTooltipsEnabled:
		$StateMenu.tooltip_text = tooltipText
	else:
		$StateMenu.tooltip_text = ""
	
	# giving code smell 😝 might rename state to 'current_action'
	match state:
		STATES.IDLE:
			sprites.play("idle", agentSpeed)
			if commandQueue.commandList.size() > 0:
				
				if commandQueue.commandList[0] is Move:
					var actionSuccessfull : bool = \
						await moveTo(commandQueue.commandList[0].desiredLocation)
					if actionSuccessfull:
						commandQueue.nextCommand()
					else:
						# complain task failed
						commandQueue.nextCommand()
				
				elif commandQueue.commandList[0] is Mine:
					state = STATES.MINING
					assert(commandQueue.commandList[0] is Mine)
					var miningBounds : Array[Vector2i] = commandQueue.commandList[0].bounds
					var currentMineTile : Tile = tiles.getTileAt(miningBounds[0])
					var tileWasMined : bool = await mineTile(currentMineTile)
					if tileWasMined:
						commandQueue.nextCommand()
					else:
						# complain task failed
						commandQueue.nextCommand()
				
				elif commandQueue.commandList[0] is Command:
					print("Huh?")
			
			# Idle movement
			elif HUD.idleMoveEnabled and randf() < 0.02:
				await _moveToNeighbor()
		
		STATES.MOVING:
			sprites.play("walk", agentSpeed)
		
		STATES.MINING:
			sprites.play("mine", 1.0)



func mineTile(tile : Tile) -> bool:
	var wasInterrupted = false
	
	if(sprites.flip_h):
		if tile.coordinates.x > coordinates.x:
			sprites.flip_h = false
	else:
		if tile.coordinates.x < coordinates.x:
			sprites.flip_h = true
	
	while not (tile.traversable or wasInterrupted): # hehe demorgan
		await get_tree().create_timer(0.55).timeout
		print("Mined a bit")
		tile.mine()
		
	state = STATES.IDLE
	if wasInterrupted:
		return false
	return true

func _moveToNeighbor():
	var neighborTiles : Array[Tile] = pathfinder.findOpenNeighbors(coordinates)
	if (neighborTiles.size() > 0):
		var chosenTile : Tile = \
		neighborTiles[randi_range(0, neighborTiles.size()-1)]
		await moveTo(chosenTile.coordinates)

# handles visual movement to new location based on path from global Pathfinder
func moveTo(newCoordinates : Vector2i) -> bool:
	state = STATES.MOVING
	
	while not newCoordinates == coordinates:
		
		# interrupt movement when move command changed
		if not commandQueue.commandList.is_empty():
			var curCommandDesLoc : Vector2i = commandQueue.commandList[0].desiredLocation
			if(newCoordinates != curCommandDesLoc):
				newCoordinates = curCommandDesLoc
		
		var path : Array[Vector2i] = \
		pathfinder.findPathTo(newCoordinates, coordinates)
		
		# return false if tile not reachable
		if path.is_empty():
			state = STATES.IDLE
			print(name+" now can't find path to location")
			return false
		
		var tileCoords : Vector2i = path[1]
		var nextTile : Tile = tiles.getTileAt(tileCoords)
		var singleTween = create_tween()
		var curMoveCost : float = nextTile.movementCost * 1/agentSpeed
		if pathfinder.isDiagNeighbor(coordinates, tileCoords):
			curMoveCost *= 1.2
		
		# change direction entity is facing
		if(sprites.flip_h):
			if tileCoords.x > coordinates.x:
				sprites.flip_h = false
		else:
			if tileCoords.x < coordinates.x:
				sprites.flip_h = true
		
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
	# user selected follow on dwarf menu
	if (index == 0):
		world.cameraFollow(self)
	elif (index == 1):
		self.queue_free()
	
# this will grow more complex
class CommandQueue:
	var commandList : Array[Command] = []
	var entity : Dwarf
	
	func _init(_entity: Dwarf):
		entity = _entity
	
	func order(command: Command) -> void:
		if _isCommandTypeInQueue(command):
			print(entity.name + " is already moving")
		else:
			commandList.append(command)

	func _isCommandTypeInQueue(command: Command) -> bool:
		#Command will be a abstract class eventually, currently I'm only letting one in at a time
		for c in commandList:
			if c.getType() == command.getType():
				return true
		return false
		
	func nextCommand() -> Command:
		return commandList.pop_front()
	
	func clear() -> void:
		commandList.clear()
	
class Command:
	var desiredLocation: Vector2i

	func _init(coordinates: Vector2i):
		desiredLocation = coordinates
		
	func getType()->String:
		var cType := "command"
		if self is Mine:
			cType = "mine"
		if self is Move:
			cType = "move"
		return cType


class Move extends Command:
	pass

class Mine extends Command:
	var bounds : Array[Vector2i]
	func _init(_bounds : Array[Vector2i]):
		bounds = _bounds

