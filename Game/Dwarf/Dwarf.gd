extends Node2D
class_name Dwarf

enum Actions {IDLE, MINING, MOVING}
enum JOBS {NOTHING, MINING}

var job : int = JOBS.NOTHING
var currentAction : int = Actions.IDLE
var coordinates : Vector2i = Vector2i()

# might have gridSize set by the game manager
var gridSize : int = 64
# 1.0 default, multipies time taken to move over tiles
var agentSpeed : float = 1.0

# contain data about tiles dwarf is thinking about, a key is a Vector2i of coordinates
var tileThoughts = {}

# Communicate with world node
@onready var world : Node2D = self.get_parent().get_parent()
# needs to grab Tiles group for path finding
@onready var tiles : TileParent = world.find_child("Tiles")
# animated sprite child
@onready var sprites : AnimatedSprite2D = $AnimatedSprite2D
@onready 
var commandNode: PackedScene = load("res://_debug/CommandNode.tscn")

@onready var pathfinder : Pathfinder = world.pathfinder
@onready var sitesToMine : SitesToMine = world.sitesToMine

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
	
	# if HUD.commandNodesShown:
	for child in $CommandContainer.get_children():
		child.queue_free()
	for c in commandQueue.commandList:
		var node : ColorRect = commandNode.instantiate()
		if c.getType() != "move":
			node.color = "#FFFFFF"
		$CommandContainer.add_child(node)
	
	match currentAction:
		Actions.IDLE:
			sprites.play("idle", agentSpeed)
			if commandQueue.commandList.size() > 0:
				await commandQueue.commandList[0].run(self)
			
			# Idle movement
			elif HUD.idleMoveEnabled and randf() < 0.005:
				currentAction = Actions.MOVING
				await _moveToNeighbor()
		
			# reached end of current command
			currentAction = Actions.IDLE
			
		Actions.MOVING:
			sprites.play("walk", agentSpeed)
		
		Actions.MINING:
			sprites.play("mine", 1.0)

func _on_state_menu_item_selected(index):
	# user selected follow on dwarf menu
	if (index == 0):
		world.cameraFollow(self)
	elif (index == 1):
		self.queue_free()

func _moveToNeighbor():
	var neighborTiles : Array[Tile] = pathfinder.findOpenNeighbors(coordinates)
	if (neighborTiles.size() > 0):
		var chosenTile : Tile = \
		neighborTiles[randi_range(0, neighborTiles.size()-1)]
		await _visuallyMoveToCoordinates(chosenTile.coordinates)

func _visuallyMoveToCoordinates(tileCoords : Vector2i):
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
	
	# Dwarf notices surroundings after each move
	_lookAround()
	
func _lookAround():
	var radius := 1
	var xCoord : int = coordinates.x-radius
	var yCoord : int = coordinates.y-radius
	# has a square field of knowledge, in the future this should be a raycast thing
	while xCoord <= coordinates.x+radius:
		var tempY := yCoord
		while tempY <= coordinates.y+radius:
			var tile : Tile = tiles.getTileAt(Vector2i(xCoord,tempY))
			if tile.orderedToMine and not tileThoughts.has(Vector2i(xCoord, tempY)):
				print("I should mine at ",Vector2i(xCoord, tempY))
				commandQueue.order(Command.Mine.new(tile))
				tileThoughts[Vector2i(xCoord, tempY)] = "mine"
			tempY+=1
		xCoord+=1

# handles visual movement to new location based on path from global Pathfinder
func moveTo(moveCommand : Command) -> bool:
	while moveCommand and not moveCommand.targetCoordinates == coordinates:
		var targetCoordinates : Vector2i = moveCommand.targetCoordinates
		
		var path : Array[Vector2i] = \
		pathfinder.findPathTo(targetCoordinates, coordinates)
		
		# return false if tile not reachable
		if path.is_empty():
			print(name+" now can't find path to location")
			return false
		
		var tileCoords : Vector2i = path[1]
		await _visuallyMoveToCoordinates(tileCoords)
		
		# if the command was deleted, for some reason setting it to idle works
		if not moveCommand:
			currentAction = Actions.IDLE
			return true
	
	return true

# Turn grid coordinates -> world/Game coordinates * gridSize
func mapToWorld(coords: Vector2i) -> Vector2:
	return Vector2(coords.x * gridSize, coords.y * gridSize)

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
		tile.mine()
		
	if wasInterrupted:
		return false
	return true


class CommandQueue:
	var commandList : Array[Command] = []
	var entity : Dwarf
	
	func _init(_entity: Dwarf):
		entity = _entity
	
	func _isCommandTypeInQueue(command: Command) -> bool:
		for c in commandList:
			if c.getType() == command.getType():
				return true
		return false
	
	func order(command: Command) -> void:
		# current implementation, move commands can stack
#		if _isCommandTypeInQueue(command):
#			print(entity.name + " is already " + command.getType())
#		else:
		commandList.append(command)
	
	func nextCommand() -> Command:
		return commandList.pop_front()
	
	func clear() -> void:
		for c in commandList:
			c.queue_free()
		commandList.clear()
