class_name Tile
extends Node2D
## Static location of space, unit of the World
##
## [Tile]s are generated in chunks and can be modified by Creatures.
## Creatures navigate through traversable tiles. 

@onready var sprite: Sprite2D = $Sprite

# parameters set when instantiated
var coordinates: Vector2i
var tooltipText: String
var tileManager: TileManager

var movementCost: float = 0.5
var traversable: bool = false

var percentMined: float = 0.0

## dictonary of [TileEffect]s with actions as keys
var effects := {}

func _ready() -> void:
	# TODO more complicated world tile generation instead of a bitmap
	if traversable:
		setToGround()
	else:
		setToRock()

func mine() -> void:
	# IDEA randomize in some way?
	# IDEA take in entity info, for like mining proficency
	percentMined += 0.2
	if percentMined >= 1.0 and not traversable:
		setToGround()

func setToRock() -> void:
	traversable = false
	sprite.texture = tileManager.tileSprites.rock
	tooltipText = "Rock"

func setToGround() -> void:
	traversable = true
	sprite.texture = tileManager.tileSprites.ground
	tooltipText = "Ground"

func addEffect(action: String, creature: Creature):
	## IDEA logic for actions should be handled here?

	if effects.has(action):
		var effect: TileEffect = effects[action]
		effect.creaturesContriburing.append(creature)
	else:
		var effect: TileEffect = tileManager.tileEffectScene.instantiate()
		effect.effectName = action
		self.add_child(effect)
		effect.playAnim()
		effect.creaturesContriburing.append(creature)
		effects[action] = effect


