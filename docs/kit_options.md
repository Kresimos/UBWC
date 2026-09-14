UBWC takes part in 3 sports: windsurfing, windsurf foiling (windfoiling) and win*g*foiling.
Rigging for each of these sports involves different components and rigging processes.

## Rigging for Each Sport

Rigging for windsurfing is what already exists in this repo.
A user selects a board and a sail and the app suggests the fin, mast, extension and boom, with an appropriate size for each.
The 'rig' tab on the bottom of the creen takes the user directly to this pipeline.

Rigging for win*d*foiling does not exist yet. 
It is very similar to windsurfing in that the rig follows the same logic.
The user selects a sail and the mast, extension and boom are suggested in the *exact* same way.
However, the app needs to suggest the *hydrofoil* (foil) to take. 
A windsurf foil board should have its own distinct label, and windsurf foils should be separate from foils for wingfoiling because they have different boxes.
The box type for a windsurf foil board should be 'Deep Tuttle (foil ready)', and likewise for the box type of a windsurf foil.

Rigging for win*g*foiling does not exist yet either. 
It is completely different from windsurfing and wingfoiling.
The user selects the board and wing, and then the only other component for the app to suggest is the foil.
The box type for a wingfoil board is 'Double US Box (wingfoil)', and likewise for a wingfoil foil.

## What the App Should Do

Rigging lives in the 'Rig' tab on the app which currently only lets you rig windsurfing kit properly.
There should be a seperate pipeline for each sport.
The menu at the top of the 'Rig' tab is shown in [this image](images/current_design14092926.png).
Between the row with 'Build' and the location menu, and the row with the 'Sail/Board' picker, I want a picker in the same visual style which toggles between windsurf, windfoil and wingfoil rigging pipelines.
For example, if I select wingfoil at the top, I should see a 'Board/Wing' picker abnd once I have selecte dthem I should be suggested a double US box hydrofoil.

Furthermore, I want to be able to go straight from the catalog to the 'Rig' tab using a 'Rig' button which is present under the image of every single sail, wing and board. 
Clicking this button should automatically direct me to the correct pipeline. 
For windsurfing and windfoiling sails, this is ambiguous because these are the same.
Clicking 'Rig' on a sail should default to the windurf rigging pipeline.
The outcome of clicking the rig button is no different that navigating to 'Rig' and selecting that piece of equipment; it is purely a shortcut to preselect that piece of kit and finish rigging from there.

