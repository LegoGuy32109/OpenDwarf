extends Node2D
class_name Dwarf

enum Actions {IDLE, MINING, MOVING}
enum Jobs {NOTHING, MINING}

var brainDisabled : bool = false
var job : int = Jobs.NOTHING
var currentAction : int = Actions.IDLE
var coordinates : Vector2i = Vector2i()

# might have gridSize set by the game manager
var gridSize : int = 64
# 1.0 default, multipies time taken to move over tileManager
var agentSpeed : float = 1.0

# Communicate with world node
@onready var world : Node2D = self.get_parent().get_parent()
# needs to grab Tiles group for path finding
@onready var tileManager : TileManager = self.get_parent().get_parent().get_node("Chunks")
# animated sprite child
@onready var sprites : AnimatedSprite2D = $AnimatedSprite2D
@onready var commandNode: PackedScene = load("res://_debug/CommandNode.tscn")

@onready var pathfinder : Pathfinder = world.pathfinder
@onready var sitesToMine : SitesToMine = world.sitesToMine

var commandQueue: CommandQueue = CommandQueue.new(self)

var tooltipText: String = ""

func _ready():
	agentSpeed = RandomNumberGenerator.new().randi_range(85, 120)/100.0
	tooltipText = "%s\nSpeed: %s" % [name, agentSpeed]

	# connect control option to HUD
	$StateMenu.item_selected.connect(HUD._on_add_dwarf_but_pressed)

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

	# entity logic
	# check if being possesed
	if brainDisabled:
		# defer actions to it's controller
		pass
	# normal behavior
	else:
		match currentAction:
			Actions.IDLE:
				sprites.play("idle", agentSpeed)
				processIdleWalk()

			Actions.MOVING:
				sprites.play("walk", agentSpeed)

			Actions.MINING:
				sprites.play("mine", 1.0)


## ran to move randomly on map
func processIdleWalk()->void:
	if HUD.idleMoveEnabled && currentAction != Actions.MOVING:
		currentAction = Actions.MOVING
		await _moveToNeighbor()
		# reached end of tile walk
		currentAction = Actions.IDLE


## User selected something in the dwarf context menu
func _on_state_menu_item_selected(index):
	match index:
		0:
			# user selected follow on dwarf menu
			world.cameraFollow(self)
			self.brainDisabled = false
		1:
			self.queue_free()
		3:
			self.brainDisabled = true


## Logic to processing which tile to move to for idle walk
func _moveToNeighbor():
	var neighborTiles : Array[Tile] = tileManager.findOpenNeighborTiles(coordinates)
	if (neighborTiles.size() > 0):
		var chosenTile : Tile = \
				neighborTiles[randi_range(0, neighborTiles.size()-1)]
		await _visuallyMoveToCoordinates(chosenTile.coordinates)


# called when entity moves to a new tile
# TODO rework this to work with the existing controller logic
func _visuallyMoveToCoordinates(tileCoords : Vector2i):
	var nextTile : Tile = tileManager.getTile(tileCoords)
	var singleTween = create_tween()
	var curMoveCost : float = nextTile.movementCost * 1/agentSpeed
	if tileManager.isDiagNeighbor(coordinates, tileCoords):
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


# handles movement to new location based on path from global Pathfinder
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

# TODO this should be a in a util class autoload
## Turn grid coordinates -> world/Game coordinates * gridSize
func mapToWorld(coords: Vector2i) -> Vector2:
	return Vector2(coords.x * gridSize, coords.y * gridSize)

func startMining(tile : Tile) -> bool:
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

		# is this a valid command for the entity? Usually true
		if command.valid(entity):
			commandList.append(command)

	func nextCommand() -> Command:
		return commandList.pop_front()

	func clear() -> void:
		for c in commandList:
			c.queue_free()
		commandList.clear()
