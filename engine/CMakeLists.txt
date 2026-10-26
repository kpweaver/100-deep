# 100 Deep engine build.
#
# Builds the unmodified upstream Angband core (upstream's own OurCoreLib
# object library) and links it with our headless protocol adapter.  The
# upstream checkout is a git submodule and is never edited.

cmake_minimum_required(VERSION 3.16)
project(HundredDeepEngine C)

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

if(EMSCRIPTEN)
	# WebAssembly build (emcmake).  Upstream's CMake insists on a native
	# frontend (ncurses etc.), so instead of add_subdirectory we take the
	# OurCoreLib source list straight from upstream's CMakeLists.txt: it
	# stays in sync with the submodule and nothing upstream is edited.
	file(READ upstream/CMakeLists.txt UPSTREAM_CMAKE)
	string(REGEX MATCH "add_library\\(OurCoreLib OBJECT([^)]*)\\)" _core "${UPSTREAM_CMAKE}")
	if(NOT CMAKE_MATCH_1)
		message(FATAL_ERROR "Could not find OurCoreLib sources in upstream/CMakeLists.txt")
	endif()
	string(REGEX REPLACE "[ \t\r\n]+" ";" CORE_SOURCES "${CMAKE_MATCH_1}")
	list(FILTER CORE_SOURCES INCLUDE REGEX "\\.c$")
	list(FILTER CORE_SOURCES EXCLUDE REGEX "/borg/")
	list(TRANSFORM CORE_SOURCES PREPEND "upstream/")

	add_executable(angband-web ${ADAPTER_SOURCES} ${CORE_SOURCES})
	set_target_properties(angband-web PROPERTIES C_STANDARD 99 OUTPUT_NAME angband SUFFIX ".mjs")
	target_include_directories(angband-web PRIVATE
		${CMAKE_CURRENT_SOURCE_DIR}/upstream/src
		${CMAKE_CURRENT_SOURCE_DIR}/adapter/src
	)
	target_compile_options(angband-web PRIVATE -O2 -Wno-unused-parameter)
	# Game data the engine reads (no tile images: the client loads those).
	# build/lib: upstream data with the renames applied (scripts/build-lib.ts)
	set(LIB ${CMAKE_CURRENT_SOURCE_DIR}/../build/lib)
	set(WEB_PRELOAD
		"SHELL:--preload-file ${LIB}/gamedata@/lib/gamedata"
		"SHELL:--preload-file ${LIB}/customize@/lib/customize"
		"SHELL:--preload-file ${LIB}/help@/lib/help"
		"SHELL:--preload-file ${LIB}/screens@/lib/screens"
		"SHELL:--preload-file ${LIB}/tiles/list.txt@/lib/tiles/list.txt"
		"SHELL:--exclude-file *.png"
		"SHELL:--preload-file ${LIB}/tiles/gervais@/lib/tiles/gervais"
	)
	# Asyncify lets the blocking "wait for the next client message" in
	# proto.c suspend into the browser event loop, so the engine runs
	# unmodified in a worker on any static host (no SharedArrayBuffer).
	target_link_options(angband-web PRIVATE
		-O2
		-sASYNCIFY=1
		-sASYNCIFY_STACK_SIZE=65536
		-sSTACK_SIZE=1048576
		-sALLOW_MEMORY_GROWTH=1
		-sMODULARIZE=1
		-sEXPORT_ES6=1
		-sEXPORT_NAME=createAngband
		-sENVIRONMENT=worker,node
		-sINVOKE_RUN=0
		-sEXIT_RUNTIME=0
		-sFORCE_FILESYSTEM=1
		-lidbfs.js
		"-sEXPORTED_RUNTIME_METHODS=FS,IDBFS,callMain"
		"-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=$stringToNewUTF8,$UTF8ToString"
		${WEB_PRELOAD}
	)
	return()
endif()

# Upstream refuses to configure without at least one frontend.  GCU is the
# lightest (system ncurses); its executable is excluded from the default
# build, we only consume OurCoreLib.
set(SUPPORT_GCU_FRONTEND ON CACHE BOOL "" FORCE)
set(SUPPORT_BORG OFF CACHE BOOL "" FORCE)
set(SC_INSTALL ON CACHE BOOL "" FORCE)

add_subdirectory(upstream EXCLUDE_FROM_ALL)

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
