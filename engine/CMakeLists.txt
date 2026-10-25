# Thangorodrim engine build.
#
# Builds the unmodified upstream Angband core (upstream's own OurCoreLib
# object library) and links it with our headless protocol adapter.  The
# upstream checkout is a git submodule and is never edited.

cmake_minimum_required(VERSION 3.16)
project(ThangorodrimEngine C)

# Upstream refuses to configure without at least one frontend.  GCU is the
# lightest (system ncurses); its executable is excluded from the default
# build, we only consume OurCoreLib.
set(SUPPORT_GCU_FRONTEND ON CACHE BOOL "" FORCE)
set(SUPPORT_BORG OFF CACHE BOOL "" FORCE)
set(SC_INSTALL ON CACHE BOOL "" FORCE)

add_subdirectory(upstream EXCLUDE_FROM_ALL)

set(ADAPTER_SOURCES
	adapter/src/json.c
	adapter/src/proto.c
	adapter/src/snapshot.c
	adapter/src/hooks.c
	adapter/src/commands.c
	adapter/src/store.c
	adapter/src/panels.c
	adapter/src/main-headless.c
)

add_executable(angband-headless
	${ADAPTER_SOURCES}
	$<TARGET_OBJECTS:OurCoreLib>
)
set_target_properties(angband-headless PROPERTIES C_STANDARD 99)
target_include_directories(angband-headless PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/upstream/src
	${CMAKE_CURRENT_SOURCE_DIR}/adapter/src
)
if(NOT MSVC)
	target_compile_options(angband-headless PRIVATE -Wall -Wextra -Wno-unused-parameter)
endif()
target_link_libraries(angband-headless PRIVATE m)
