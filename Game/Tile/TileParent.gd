extends Node2D
class_name TileParent

func getTileAt(coords : Vector2i) -> Tile:
	if coords.x >= self.get_children().size() or coords.y >= self.get_children().size():
		return null
	return self.get_children()[coords.x].get_children()[coords.y]
