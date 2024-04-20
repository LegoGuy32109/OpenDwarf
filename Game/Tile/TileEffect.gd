extends AnimatedSprite2D
class_name TileEffect

var creaturesContriburing: Array[Creature] = []
var effectName: String

# self.sprite_frames.get_animation_names()

# func _init(tile: Tile, effect: String):
# 	tile.add_child(self)
# 	self.play('target')
# 	print("%s on %s" % [effect, tile.coordinates])

func playAnim() -> void:
	self.play('target')
